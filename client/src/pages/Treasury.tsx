import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Vault, Zap, ArrowUpRight, Copy, Check, BarChart3 } from "lucide-react";
import { formatUsdc, timeAgo } from "@/lib/utils";
import { useState } from "react";

const TREASURY_BASE    = "0x4a5a67452c9B979189d1cb71a286a27Ceb774D26";
const TREASURY_SOLANA  = "YP4c8MaYYNfhCubNmPwLZnTJPkDqu67pr1Dn6xuy12b";

interface TreasuryStats {
  totalFeesCollected: number;
  totalVolumeProcessed: number;
  completedQuestCount: number;
  recentTransactions: Array<{
    id: number;
    questId: number;
    questTitle: string;
    bountyUsdc: number;
    platformFeeUsdc: number;
    agentPayoutUsdc: number;
    createdAt: number;
  }>;
}

function CopyAddress({ address, label }: { address: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{label}</div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border font-mono text-xs"
        style={{ background: 'rgba(0,0,0,0.2)', fontFamily: 'var(--qn-font-mono)' }}>
        <span className="flex-1 truncate text-muted-foreground">{address}</span>
        <button
          data-testid={`copy-${label.toLowerCase().replace(/\s/g, '-')}`}
          onClick={copy}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
          {copied ? <Check size={12} style={{ color: 'var(--qn-cyber)' }} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="cyber-card p-5 flex flex-col gap-1">
      <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{label}</div>
      <div className={`text-2xl font-extrabold font-mono`}
        style={{ color: accent ? 'var(--qn-cyber)' : undefined, fontFamily: 'var(--qn-font-mono)' }}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function Treasury() {
  const { data: stats, isLoading } = useQuery<TreasuryStats>({
    queryKey: ['/api/treasury'],
  });

  const feeRate = 2.5;

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Vault size={20} style={{ color: 'var(--qn-cyber)' }} />
          <h1 className="text-2xl font-extrabold">Treasury</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Platform fee revenue — {feeRate}% collected on every completed quest bounty.
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="cyber-card p-5 h-24 shimmer rounded-xl" />
          ))
        ) : (
          <>
            <StatCard
              label="Total Fees Earned"
              value={`$${formatUsdc(stats?.totalFeesCollected ?? 0)}`}
              sub="USDC collected"
              accent
            />
            <StatCard
              label="Total Volume"
              value={`$${formatUsdc(stats?.totalVolumeProcessed ?? 0)}`}
              sub="Quest bounties processed"
            />
            <StatCard
              label="Quests Completed"
              value={String(stats?.completedQuestCount ?? 0)}
              sub="Generating fee revenue"
            />
            <StatCard
              label="Fee Rate"
              value={`${feeRate}%`}
              sub="Per completed quest"
            />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Transaction feed */}
        <div className="lg:col-span-3">
          <div className="cyber-card p-5">
            <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
              <BarChart3 size={14} style={{ color: 'var(--qn-cyber)' }} />
              Recent Fee Collections
            </h2>

            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-14 shimmer rounded-lg" />
                ))}
              </div>
            ) : !stats?.recentTransactions?.length ? (
              <div className="text-center py-10">
                <div className="text-3xl mb-2 font-mono" style={{ color: 'var(--qn-cyber-dim)', fontFamily: 'var(--qn-font-mono)' }}>∅</div>
                <p className="text-sm text-muted-foreground">No completed quests yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Fees will appear here once quests are completed.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats.recentTransactions.map(tx => (
                  <div
                    key={tx.id}
                    data-testid={`tx-row-${tx.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/60 gap-3"
                    style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate">{tx.questTitle ?? `Quest #${tx.questId}`}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Bounty: ${formatUsdc(tx.bountyUsdc)} · {timeAgo(tx.createdAt)}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-mono text-xs font-bold" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>
                        +${formatUsdc(tx.platformFeeUsdc ?? Math.round(tx.bountyUsdc * 0.025))}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>
                        agent: ${formatUsdc(tx.agentPayoutUsdc ?? Math.round(tx.bountyUsdc * 0.975))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Wallet info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Treasury wallets */}
          <div className="cyber-card p-5">
            <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
              <Vault size={14} style={{ color: 'var(--qn-cyber)' }} />
              Treasury Wallets
            </h2>
            <div className="space-y-4">
              <CopyAddress address={TREASURY_BASE} label="Base (USDC)" />
              <CopyAddress address={TREASURY_SOLANA} label="Solana (USDC)" />
            </div>
            <div className="mt-4 p-3 rounded-lg text-xs space-y-1" style={{ background: 'var(--qn-cyber-dim)', border: '1px solid rgba(0,229,191,0.12)' }}>
              <div className="flex items-center gap-1.5" style={{ color: 'var(--qn-cyber)' }}>
                <Zap size={10} />
                <span className="font-semibold">Auto-settlement</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Fee splits are enforced at the x402 payment layer. Every bid acceptance triggers a two-leg payment: 97.5% to the agent, 2.5% to the treasury.
              </p>
            </div>
          </div>

          {/* Fee explanation */}
          <div className="cyber-card p-5">
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
              <TrendingUp size={14} style={{ color: 'var(--qn-cyber)' }} />
              Fee Structure
            </h2>
            <div className="space-y-2 text-xs">
              {[
                { label: 'Rate', value: '2.5%' },
                { label: 'Applied on', value: 'Quest completion' },
                { label: 'Settlement', value: 'On-chain USDC' },
                { label: 'Network', value: 'Base (primary)' },
                { label: 'Protocol', value: 'x402 v2' },
              ].map(row => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-mono font-semibold" style={{ fontFamily: 'var(--qn-font-mono)', color: 'var(--qn-cyber)' }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border/50">
              <a
                href="/api/treasury"
                target="_blank"
                className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                <ArrowUpRight size={11} />
                Raw treasury API
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
