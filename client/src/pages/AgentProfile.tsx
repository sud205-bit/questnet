import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ArrowLeft, Zap, Copy, ExternalLink, Star } from "lucide-react";
import { formatUsdc, categoryClass, timeAgo, shortenAddress } from "@/lib/utils";
import type { Agent, Bid, Review } from "@shared/schema";

type AgentWithDetails = Agent & { reviews: Review[]; bids: Bid[] };

export default function AgentProfile() {
  const { id } = useParams<{ id: string }>();

  const { data: agent, isLoading } = useQuery<AgentWithDetails>({
    queryKey: [`/api/agents/${id}`],
  });

  if (isLoading) {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-8 space-y-4">
        <div className="h-6 w-24 shimmer rounded" />
        <div className="h-48 shimmer rounded-xl" />
      </div>
    );
  }

  if (!agent) return (
    <div className="max-w-[800px] mx-auto px-4 py-16 text-center">
      <h2 className="font-bold text-xl mb-2">Agent not found</h2>
      <Link href="/agents"><button className="text-sm text-primary hover:underline">Back to Agents</button></Link>
    </div>
  );

  const caps: string[] = (() => { try { return JSON.parse(agent.capabilities); } catch { return []; } })();

  const typeColors: Record<string, string> = {
    data: 'var(--qn-cyber)', code: 'var(--qn-violet)', research: '#60a5fa', trade: 'var(--qn-amber)', general: '#9ca3af',
  };
  const color = typeColors[agent.agentType] ?? '#9ca3af';

  return (
    <div className="max-w-[800px] mx-auto px-4 py-8">
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft size={14} /> Agent Network
      </Link>

      {/* Profile header */}
      <div className="cyber-card p-6 mb-5">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-mono font-extrabold text-xl flex-shrink-0"
            style={{ background: `${color}18`, color, border: `1px solid ${color}30`, fontFamily: 'var(--qn-font-mono)' }}>
            {agent.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-extrabold">{agent.displayName}</h1>
              <div className={agent.isOnline ? 'online-dot' : 'offline-dot'}></div>
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}>
                {agent.agentType}
              </span>
            </div>
            <div className="text-sm text-muted-foreground font-mono mt-0.5" style={{ fontFamily: 'var(--qn-font-mono)' }}>@{agent.handle}</div>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{agent.bio}</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 mt-5 pt-5 border-t border-border/50">
          {[
            { label: 'Rating', value: `★ ${agent.rating.toFixed(1)}` },
            { label: 'Completed', value: agent.completedQuests },
            { label: 'Reviews', value: agent.reviews?.length ?? 0 },
            { label: 'Total Earned', value: `$${formatUsdc(agent.totalEarned)}` },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="font-mono font-bold text-sm" style={{ color, fontFamily: 'var(--qn-font-mono)' }}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        {/* Main column */}
        <div className="md:col-span-2 space-y-5">
          {/* Capabilities */}
          <div className="cyber-card p-5">
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <span style={{ color }}>▲</span> Capabilities
            </h3>
            <div className="flex flex-wrap gap-2">
              {caps.map(c => (
                <span key={c} className="text-xs px-2.5 py-1 rounded font-mono"
                  style={{ background: `${color}12`, color, border: `1px solid ${color}20`, fontFamily: 'var(--qn-font-mono)' }}>
                  {c}
                </span>
              ))}
              {caps.length === 0 && <span className="text-xs text-muted-foreground">No capabilities listed</span>}
            </div>
          </div>

          {/* Reviews */}
          <div className="cyber-card p-5">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
              <Star size={14} style={{ color }} /> Reviews ({agent.reviews?.length ?? 0})
            </h3>
            {!agent.reviews?.length ? (
              <p className="text-sm text-muted-foreground">No reviews yet.</p>
            ) : (
              <div className="space-y-3">
                {agent.reviews.map(r => (
                  <div key={r.id} className="p-3 rounded-lg border border-border/50" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono" style={{ color }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                      <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                    </div>
                    {r.comment && <p className="text-xs text-muted-foreground">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Wallet */}
          <div className="cyber-card p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Wallet</h3>
            <div className="flex items-center gap-2 p-2 rounded-md font-mono text-xs border border-border"
              style={{ background: 'rgba(0,0,0,0.2)', fontFamily: 'var(--qn-font-mono)' }}>
              <span className="text-muted-foreground flex-1 truncate">{shortenAddress(agent.walletAddress)}</span>
              <button onClick={() => navigator.clipboard.writeText(agent.walletAddress)}
                className="text-muted-foreground hover:text-foreground"><Copy size={11} /></button>
            </div>
            <div className="mt-2 text-xs text-muted-foreground font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>
              Accepts USDC on Base & Solana
            </div>
          </div>

          {/* x402 info */}
          <div className="cyber-card p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
              <Zap size={11} style={{ color: 'var(--qn-cyber)' }} /> Payment Protocol
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Accepts</span>
                <span className="font-mono" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>x402, Direct</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Network</span>
                <span>Base, Solana</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Asset</span>
                <span>USDC</span>
              </div>
            </div>
          </div>

          {/* Post quest CTA */}
          <Link href="/post">
            <button className="w-full py-2.5 rounded-lg text-sm font-bold"
              style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}>
              POST QUEST FOR THIS AGENT
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
