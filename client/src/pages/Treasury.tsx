import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Vault, Zap, BarChart3, Lock, Eye, EyeOff } from "lucide-react";
import { formatUsdc, timeAgo } from "@/lib/utils";
import { useState, useCallback } from "react";

const TREASURY_BASE   = "0x2D6d4E1E97C95007732C7E9B54931aAC08345967";
const TREASURY_SOLANA = "GZpfkCj74j3xahdCdPE6WF71RoHWR5BHAaE4V2Zd6snj";

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
        style={{ background: "rgba(0,0,0,0.2)", fontFamily: "var(--qn-font-mono)" }}>
        <span className="flex-1 truncate text-muted-foreground">{address}</span>
        <button onClick={copy} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
          {copied
            ? <span style={{ color: "var(--qn-cyber)", fontSize: 10 }}>✓</span>
            : <span style={{ fontSize: 10 }}>⎘</span>}
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="cyber-card p-5 flex flex-col gap-1">
      <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{label}</div>
      <div className="text-2xl font-extrabold font-mono"
        style={{ color: accent ? "var(--qn-cyber)" : undefined, fontFamily: "var(--qn-font-mono)" }}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Password Gate ─────────────────────────────────────────────────────────────
function PasswordGate({ onAuth }: { onAuth: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const attempt = useCallback(async () => {
    if (!pw.trim()) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/treasury", {
        headers: { "x-treasury-password": pw },
      });
      if (res.ok) {
        onAuth(pw);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [pw, onAuth]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="cyber-card p-8 w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: "var(--qn-cyber-dim)", border: "1px solid rgba(0,229,191,0.2)" }}>
            <Lock size={20} style={{ color: "var(--qn-cyber)" }} />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-extrabold">Treasury Access</h1>
            <p className="text-xs text-muted-foreground mt-1">This page is private. Enter your password to continue.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={pw}
              onChange={e => { setPw(e.target.value); setError(false); }}
              onKeyDown={e => e.key === "Enter" && attempt()}
              placeholder="Treasury password"
              autoFocus
              className="w-full px-4 py-2.5 pr-10 rounded-lg border text-sm bg-background font-mono outline-none focus:ring-2 transition-all"
              style={{
                fontFamily: "var(--qn-font-mono)",
                borderColor: error ? "#ef4444" : "var(--border)",
                boxShadow: error ? "0 0 0 2px rgba(239,68,68,0.2)" : undefined,
              }}
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-400 text-center">Incorrect password. Try again.</p>
          )}

          <button
            onClick={attempt}
            disabled={loading || !pw.trim()}
            className="w-full py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
            style={{ background: "var(--qn-cyber)", color: "#0a0f0e", fontFamily: "var(--qn-font-mono)" }}>
            {loading ? "Verifying…" : "UNLOCK TREASURY"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Treasury Dashboard ────────────────────────────────────────────────────
function TreasuryDashboard({ password }: { password: string }) {
  const { data: stats, isLoading } = useQuery<TreasuryStats>({
    queryKey: ["/api/treasury", password],
    queryFn: () =>
      fetch("/api/treasury", { headers: { "x-treasury-password": password } })
        .then(r => r.json()),
  });

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Vault size={20} style={{ color: "var(--qn-cyber)" }} />
          <h1 className="text-2xl font-extrabold">Treasury</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Platform fee revenue — 2.5% collected on every completed quest bounty.
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
            <StatCard label="Total Fees Earned"   value={`$${formatUsdc(stats?.totalFeesCollected ?? 0)}`}  sub="USDC collected"              accent />
            <StatCard label="Total Volume"         value={`$${formatUsdc(stats?.totalVolumeProcessed ?? 0)}`} sub="Quest bounties processed" />
            <StatCard label="Quests Completed"     value={String(stats?.completedQuestCount ?? 0)}            sub="Generating fee revenue"   />
            <StatCard label="Fee Rate"             value="2.5%"                                               sub="Per completed quest"      />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Transaction feed */}
        <div className="lg:col-span-3">
          <div className="cyber-card p-5">
            <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
              <BarChart3 size={14} style={{ color: "var(--qn-cyber)" }} />
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
                <div className="text-3xl mb-2 font-mono" style={{ color: "var(--qn-cyber-dim)", fontFamily: "var(--qn-font-mono)" }}>∅</div>
                <p className="text-sm text-muted-foreground">No completed quests yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Fees will appear here once quests are completed.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats.recentTransactions.map(tx => (
                  <div key={tx.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/60 gap-3"
                    style={{ background: "rgba(255,255,255,0.02)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate">{tx.questTitle ?? `Quest #${tx.questId}`}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Bounty: ${formatUsdc(tx.bountyUsdc)} · {timeAgo(tx.createdAt)}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-mono text-xs font-bold" style={{ color: "var(--qn-cyber)", fontFamily: "var(--qn-font-mono)" }}>
                        +${formatUsdc(tx.platformFeeUsdc ?? Math.round(tx.bountyUsdc * 0.025))}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono" style={{ fontFamily: "var(--qn-font-mono)" }}>
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
          <div className="cyber-card p-5">
            <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
              <Vault size={14} style={{ color: "var(--qn-cyber)" }} />
              Treasury Wallets
            </h2>
            <div className="space-y-4">
              <CopyAddress address={TREASURY_BASE}   label="Base (USDC)" />
              <CopyAddress address={TREASURY_SOLANA} label="Solana (USDC)" />
            </div>
            <div className="mt-4 p-3 rounded-lg text-xs space-y-1"
              style={{ background: "var(--qn-cyber-dim)", border: "1px solid rgba(0,229,191,0.12)" }}>
              <div className="flex items-center gap-1.5" style={{ color: "var(--qn-cyber)" }}>
                <Zap size={10} />
                <span className="font-semibold">Auto-settlement</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Fee splits enforced at x402 layer. Every bid acceptance triggers a two-leg payment: 97.5% to agent, 2.5% to treasury.
              </p>
            </div>
          </div>

          <div className="cyber-card p-5">
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
              <TrendingUp size={14} style={{ color: "var(--qn-cyber)" }} />
              Fee Structure
            </h2>
            <div className="space-y-2 text-xs">
              {[
                { label: "Rate",        value: "2.5%" },
                { label: "Applied on",  value: "Quest completion" },
                { label: "Settlement",  value: "On-chain USDC" },
                { label: "Network",     value: "Base (primary)" },
                { label: "Protocol",    value: "x402 v2" },
              ].map(row => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-mono font-semibold"
                    style={{ fontFamily: "var(--qn-font-mono)", color: "var(--qn-cyber)" }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root export — handles auth state ─────────────────────────────────────────
export default function Treasury() {
  const [password, setPassword] = useState<string | null>(null);

  if (!password) {
    return <PasswordGate onAuth={setPassword} />;
  }

  return <TreasuryDashboard password={password} />;
}
