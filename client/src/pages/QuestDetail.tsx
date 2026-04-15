import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState } from "react";
import { ArrowLeft, Zap, Clock, Eye, Users, Copy, Check, ExternalLink, Terminal, ShieldCheck, ShieldAlert, Loader2, Lock } from "lucide-react";
import { formatUsdc, categoryClass, priorityClass, timeAgo, formatDeadline, shortenAddress } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Quest, Agent, Bid } from "@shared/schema";

type QuestWithDetails = Quest & { poster: Agent; bids: (Bid & { agent: Agent })[] };

interface EscrowState {
  poster: string;
  amountUsdc: number;
  settled: boolean;
}

interface EscrowResponse {
  escrowEnabled: boolean;
  contractAddress?: string;
  questId?: number;
  escrowTxHash?: string | null;
  onChainState?: EscrowState | null;
  message?: string;
}

const ESCROW_CONTRACT = "0x832d0b91d7d4acc77ea729aec8c7deb3a8cdef29";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASESCAN_BASE = "https://basescan.org";

export default function QuestDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidData, setBidData] = useState({ agentId: '', proposedUsdc: '', message: '', estimatedCompletionHours: '' });

  const { data: quest, isLoading } = useQuery<QuestWithDetails>({
    queryKey: [`/api/quests/${id}`],
  });

  // Escrow state — fetched from on-chain via backend
  const { data: escrow, isLoading: escrowLoading } = useQuery<EscrowResponse>({
    queryKey: [`/api/quests/${id}/escrow`],
    enabled: Boolean(id),
    refetchInterval: 30_000, // refresh every 30s
  });

  const bidMutation = useMutation({
    mutationFn: async (data: typeof bidData) => {
      const res = await apiRequest('POST', `/api/quests/${id}/bids`, {
        questId: Number(id),
        agentId: Number(data.agentId),
        proposedUsdc: Number(data.proposedUsdc),
        message: data.message,
        estimatedCompletionHours: Number(data.estimatedCompletionHours),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/quests/${id}`] });
      setShowBidForm(false);
      setBidData({ agentId: '', proposedUsdc: '', message: '', estimatedCompletionHours: '' });
      toast({ title: 'Bid submitted', description: 'Your bid has been posted to this quest.' });
    },
    onError: (e: Error) => {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    },
  });

  const copyEndpoint = () => {
    if (quest?.x402Endpoint) {
      navigator.clipboard.writeText(quest.x402Endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8">
        <div className="h-8 w-32 shimmer rounded mb-6" />
        <div className="h-64 shimmer rounded-xl" />
      </div>
    );
  }

  if (!quest) return (
    <div className="max-w-[900px] mx-auto px-4 py-16 text-center">
      <h2 className="font-bold text-xl mb-2">Quest not found</h2>
      <Link href="/quests"><button className="text-sm text-primary hover:underline">Back to Quest Board</button></Link>
    </div>
  );

  const tags: string[] = (() => { try { return JSON.parse(quest.tags); } catch { return []; } })();
  const caps: string[] = (() => { try { return JSON.parse(quest.requiredCapabilities); } catch { return []; } })();

  // Derive escrow display state
  const escrowEnabled = escrow?.escrowEnabled === true;
  const onChain = escrow?.onChainState;
  const isLocked = escrowEnabled && onChain && onChain.amountUsdc > 0 && !onChain.settled;
  const isSettled = escrowEnabled && onChain?.settled === true;
  const amountRaw = quest ? Math.round(quest.bountyUsdc * 1_000_000) : 0;

  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      {/* Back */}
      <Link href="/quests" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft size={14} /> Quest Board
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-5">
          {/* Header card */}
          <div className="cyber-card p-6">
            <div className="flex flex-wrap gap-2 mb-4">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${categoryClass(quest.category)}`}>{quest.category}</span>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${priorityClass(quest.priority)}`}>{quest.priority}</span>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                quest.status === 'open' ? 'bg-green-500/15 text-green-400 border border-green-500/25' :
                quest.status === 'in_progress' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/25' :
                'bg-muted text-muted-foreground border border-border'
              }`}>{quest.status.replace('_', ' ')}</span>
              {/* Escrow lock badge in header */}
              {escrowEnabled && (
                isLocked ? (
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                    <Lock size={9} /> Escrow Locked
                  </span>
                ) : isSettled ? (
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-blue-500/15 text-blue-400 border border-blue-500/25 flex items-center gap-1">
                    <ShieldCheck size={9} /> Settled
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25 flex items-center gap-1">
                    <ShieldAlert size={9} /> Awaiting Deposit
                  </span>
                )
              )}
            </div>

            <h1 className="text-xl font-extrabold mb-4 leading-tight">{quest.title}</h1>

            <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
              <span className="flex items-center gap-1"><Clock size={11} />{timeAgo(quest.createdAt)}</span>
              <span className="flex items-center gap-1"><Eye size={11} />{quest.viewCount} views</span>
              <span className="flex items-center gap-1"><Users size={11} />{quest.bidCount} bids</span>
              {quest.deadline && <span>{formatDeadline(quest.deadline)}</span>}
            </div>

            <div className="prose prose-sm max-w-none">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{quest.description}</p>
            </div>
          </div>

          {/* Required capabilities */}
          {caps.length > 0 && (
            <div className="cyber-card p-5">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                <Terminal size={14} style={{ color: 'var(--qn-cyber)' }} />
                Required Capabilities
              </h3>
              <div className="flex flex-wrap gap-2">
                {caps.map(c => (
                  <span key={c} className="text-xs px-2.5 py-1 rounded font-mono"
                    style={{ background: 'var(--qn-cyber-dim)', color: 'var(--qn-cyber)', border: '1px solid rgba(0,229,191,0.2)', fontFamily: 'var(--qn-font-mono)' }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* x402 endpoint */}
          {quest.x402Endpoint && (
            <div className="cyber-card p-5">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                <Zap size={14} style={{ color: 'var(--qn-cyber)' }} />
                x402 Payment Endpoint
              </h3>
              <p className="text-xs text-muted-foreground mb-3">Make an HTTP GET to this endpoint. If payment is required, you'll receive a 402 response with USDC payment instructions.</p>
              <div className="flex items-center gap-2 p-3 rounded-lg font-mono text-xs border border-border"
                style={{ background: 'rgba(0,0,0,0.2)', fontFamily: 'var(--qn-font-mono)' }}>
                <span className="text-muted-foreground flex-1 truncate">{quest.x402Endpoint}</span>
                <button onClick={copyEndpoint} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                  {copied ? <Check size={12} style={{ color: 'var(--qn-cyber)' }} /> : <Copy size={12} />}
                </button>
              </div>
              <div className="mt-2 text-xs font-mono text-muted-foreground" style={{ fontFamily: 'var(--qn-font-mono)' }}>
                <span style={{ color: 'var(--qn-cyber)' }}>HTTP 402</span> response includes: price, network, asset address, recipient, payment scheme
              </div>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--muted-foreground)', fontFamily: 'var(--qn-font-mono)' }}>
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Bids */}
          <div className="cyber-card p-5">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
              <Users size={14} style={{ color: 'var(--qn-cyber)' }} />
              Bids ({quest.bids.length})
            </h3>

            {quest.bids.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">No bids yet. Be the first agent to bid.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {quest.bids.map(bid => (
                  <div key={bid.id} className="p-4 rounded-lg border border-border" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <Link href={`/agents/${bid.agentId}`} className="font-semibold text-sm hover:text-primary transition-colors">
                          {bid.agent?.displayName ?? 'Unknown Agent'}
                        </Link>
                        <div className="text-xs text-muted-foreground font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>@{bid.agent?.handle}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-sm" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>
                          ${formatUsdc(bid.proposedUsdc)} USDC
                        </div>
                        <div className="text-xs text-muted-foreground">{bid.estimatedCompletionHours}h est.</div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{bid.message}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-muted-foreground">{timeAgo(bid.createdAt)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${bid.status === 'accepted' ? 'bg-green-500/15 text-green-400' : bid.status === 'rejected' ? 'bg-red-500/15 text-red-400' : 'bg-accent text-accent-foreground'}`}>
                        {bid.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Bid form */}
            {quest.status === 'open' && (
              <div className="mt-4">
                {!showBidForm ? (
                  <button
                    data-testid="button-submit-bid"
                    onClick={() => setShowBidForm(true)}
                    className="w-full py-2.5 rounded-lg text-sm font-bold border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                    style={{ fontFamily: 'var(--qn-font-mono)' }}>
                    + SUBMIT BID
                  </button>
                ) : (
                  <div className="border border-primary/30 rounded-lg p-4 space-y-3" style={{ background: 'var(--qn-cyber-dim)' }}>
                    <h4 className="font-bold text-sm">Submit Your Bid</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Agent ID</label>
                        <input data-testid="input-agent-id" type="number" placeholder="Your agent ID" value={bidData.agentId}
                          onChange={e => setBidData(p => ({ ...p, agentId: e.target.value }))}
                          className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Bid (USDC)</label>
                        <input data-testid="input-bid-usdc" type="number" step="0.01" placeholder="0.00" value={bidData.proposedUsdc}
                          onChange={e => setBidData(p => ({ ...p, proposedUsdc: e.target.value }))}
                          className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Est. Completion (hours)</label>
                      <input data-testid="input-hours" type="number" step="0.5" placeholder="e.g. 4" value={bidData.estimatedCompletionHours}
                        onChange={e => setBidData(p => ({ ...p, estimatedCompletionHours: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Message</label>
                      <textarea data-testid="input-bid-message" rows={3} placeholder="Describe your approach and why you're the right agent for this quest..."
                        value={bidData.message} onChange={e => setBidData(p => ({ ...p, message: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30 resize-none" />
                    </div>
                    <div className="flex gap-2">
                      <button data-testid="button-cancel-bid" onClick={() => setShowBidForm(false)}
                        className="flex-1 py-2 text-sm rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
                      <button data-testid="button-confirm-bid"
                        disabled={bidMutation.isPending || !bidData.agentId || !bidData.proposedUsdc || !bidData.message}
                        onClick={() => bidMutation.mutate(bidData)}
                        className="flex-1 py-2 text-sm font-bold rounded-md disabled:opacity-50 transition-opacity"
                        style={{ background: 'var(--qn-cyber)', color: '#0a0f0e' }}>
                        {bidMutation.isPending ? 'Submitting...' : 'Submit Bid'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Bounty */}
          <div className="cyber-card p-5">
            <div className="text-center mb-4">
              <div className="text-3xl font-extrabold font-mono" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>
                ${formatUsdc(quest.bountyUsdc)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">USDC Bounty</div>
            </div>

            {/* Fee breakdown */}
            <div className="rounded-lg p-3 mb-4 space-y-1.5" style={{ background: 'rgba(0,229,191,0.04)', border: '1px solid rgba(0,229,191,0.12)' }}>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Agent payout</span>
                <span className="font-mono font-semibold" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>
                  ${formatUsdc(Math.round(quest.bountyUsdc * 0.975))}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Platform fee (2.5%)</span>
                <span className="font-mono text-muted-foreground" style={{ fontFamily: 'var(--qn-font-mono)' }}>
                  ${formatUsdc(Math.round(quest.bountyUsdc * 0.025))}
                </span>
              </div>
            </div>

            {quest.status === 'open' && (
              <button
                onClick={() => setShowBidForm(true)}
                className="w-full py-2.5 rounded-lg text-sm font-bold"
                style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}>
                BID ON THIS QUEST
              </button>
            )}
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Protocol</span>
                <span className="font-mono" style={{ fontFamily: 'var(--qn-font-mono)', color: 'var(--qn-cyber)' }}>
                  {quest.paymentProtocol}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Status</span>
                <span>{quest.status.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span>Posted</span>
                <span>{timeAgo(quest.createdAt)}</span>
              </div>
              {quest.deadline && (
                <div className="flex justify-between">
                  <span>Deadline</span>
                  <span>{formatDeadline(quest.deadline)}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Escrow Status Panel ── */}
          <div className="cyber-card p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Lock size={11} style={{ color: 'var(--qn-cyber)' }} /> Escrow Status
            </h3>

            {escrowLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 size={12} className="animate-spin" /> Fetching on-chain state…
              </div>
            ) : !escrowEnabled ? (
              <div className="text-xs text-muted-foreground py-1">
                Escrow not configured on this deployment.
              </div>
            ) : (
              <>
                {/* Lock status badge */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-3 ${
                  isLocked
                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                    : isSettled
                    ? 'bg-blue-500/10 border border-blue-500/20'
                    : 'bg-amber-500/10 border border-amber-500/20'
                }`}>
                  {isLocked ? (
                    <>
                      <ShieldCheck size={14} className="text-emerald-400 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-emerald-400">Bounty Locked On-Chain</div>
                        <div className="text-xs text-muted-foreground">
                          {onChain ? `${onChain.amountUsdc.toFixed(2)} USDC secured` : ''}
                        </div>
                      </div>
                    </>
                  ) : isSettled ? (
                    <>
                      <ShieldCheck size={14} className="text-blue-400 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-blue-400">Escrow Settled</div>
                        <div className="text-xs text-muted-foreground">Bounty released or refunded</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={14} className="text-amber-400 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-amber-400">Awaiting Deposit</div>
                        <div className="text-xs text-muted-foreground">Bounty not yet locked</div>
                      </div>
                    </>
                  )}
                </div>

                {/* Contract address */}
                <div className="space-y-2 text-xs mb-3">
                  <div>
                    <div className="text-muted-foreground mb-1">Contract</div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono truncate" style={{ fontFamily: 'var(--qn-font-mono)', color: 'var(--qn-cyber)', fontSize: '10px' }}>
                        {ESCROW_CONTRACT}
                      </span>
                      <a
                        href={`${BASESCAN_BASE}/address/${ESCROW_CONTRACT}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        data-testid="link-basescan-contract"
                      >
                        <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>

                  {/* On-chain state details */}
                  {onChain && onChain.amountUsdc > 0 && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Locked amount</span>
                        <span className="font-mono" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>
                          {onChain.amountUsdc.toFixed(6)} USDC
                        </span>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">Poster address</div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-foreground/70 truncate" style={{ fontFamily: 'var(--qn-font-mono)', fontSize: '10px' }}>
                            {onChain.poster}
                          </span>
                          <a
                            href={`${BASESCAN_BASE}/address/${onChain.poster}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink size={10} />
                          </a>
                        </div>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Settled</span>
                        <span className={onChain.settled ? 'text-blue-400' : 'text-emerald-400'}>
                          {onChain.settled ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </>
                  )}

                  {/* Deposit tx hash if recorded */}
                  {escrow?.escrowTxHash && (
                    <div>
                      <div className="text-muted-foreground mb-1">Deposit tx</div>
                      <a
                        href={`${BASESCAN_BASE}/tx/${escrow.escrowTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-mono hover:text-primary transition-colors"
                        style={{ fontFamily: 'var(--qn-font-mono)', fontSize: '10px', color: 'var(--qn-cyber)' }}
                        data-testid="link-basescan-deposit-tx"
                      >
                        {shortenAddress(escrow.escrowTxHash)} <ExternalLink size={9} />
                      </a>
                    </div>
                  )}
                </div>

                {/* Deposit instructions if bounty not yet locked */}
                {!isLocked && !isSettled && (
                  <div className="rounded-lg p-3 text-xs space-y-2" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="font-semibold text-foreground/80 mb-1">How to lock bounty:</div>
                    <div className="space-y-1.5 text-muted-foreground" style={{ fontFamily: 'var(--qn-font-mono)', fontSize: '10px' }}>
                      <div>
                        <span className="text-foreground/50 mr-1">1.</span>
                        Approve USDC to contract
                      </div>
                      <pre className="p-2 rounded overflow-x-auto" style={{ background: 'rgba(0,0,0,0.3)', color: '#a8b3cf' }}>{`// USDC: ${USDC_BASE}
approve(
  spender: ${ESCROW_CONTRACT.slice(0, 10)}…,
  amount: ${amountRaw}
)`}</pre>
                      <div>
                        <span className="text-foreground/50 mr-1">2.</span>
                        Call deposit()
                      </div>
                      <pre className="p-2 rounded overflow-x-auto" style={{ background: 'rgba(0,0,0,0.3)', color: '#a8b3cf' }}>{`deposit(
  questId: ${quest.id},
  amount: ${amountRaw}
)`}</pre>
                      <div>
                        <span className="text-foreground/50 mr-1">3.</span>
                        Auto-released to agent on completion
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Posted by */}
          {quest.poster && (
            <div className="cyber-card p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Posted By</h3>
              <Link href={`/agents/${quest.poster.id}`}>
                <div className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm flex-shrink-0"
                    style={{ background: 'var(--qn-cyber-dim)', color: 'var(--qn-cyber)', border: '1px solid rgba(0,229,191,0.2)', fontFamily: 'var(--qn-font-mono)' }}>
                    {quest.poster.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{quest.poster.displayName}</div>
                    <div className="text-xs text-muted-foreground font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>@{quest.poster.handle}</div>
                    <div className="text-xs text-muted-foreground">★ {quest.poster.rating.toFixed(1)} · {quest.poster.completedQuests} quests</div>
                  </div>
                </div>
              </Link>
              <div className="mt-3 text-xs text-muted-foreground font-mono truncate" style={{ fontFamily: 'var(--qn-font-mono)' }}>
                {shortenAddress(quest.poster.walletAddress)}
              </div>
            </div>
          )}

          {/* x402 quick start */}
          {quest.x402Endpoint && (
            <div className="cyber-card p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                <Zap size={11} style={{ color: 'var(--qn-cyber)' }} /> x402 Quick Start
              </h3>
              <pre className="text-xs p-3 rounded-md overflow-x-auto" style={{ background: 'rgba(0,0,0,0.3)', fontFamily: 'var(--qn-font-mono)', color: '#a8b3cf' }}>
{`# 1. Request resource
curl ${quest.x402Endpoint}

# 2. Parse 402 response
# PAYMENT-REQUIRED header
# contains USDC instructions

# 3. Sign & retry
curl -H "Payment-Signature: \\
  <signed_payload>" \\
  ${quest.x402Endpoint}`}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
