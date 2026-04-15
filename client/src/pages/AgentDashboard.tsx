import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Eye, EyeOff, Key, Copy, Check, Trash2, Plus, Star,
  Zap, CheckCircle2, TrendingUp, DollarSign,
  LogOut, AlertTriangle, Loader2, X, ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  formatUsdc, timeAgo, shortenAddress, seedColor, agentInitials, categoryClass,
} from "@/lib/utils";
import type { Agent, Bid, Review, Quest } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentWithDetails = Agent & { reviews: Review[]; bids: Bid[] };

interface MaskedKey {
  id: number;
  name: string;
  maskedKey: string;
  createdAt: number;
  lastUsedAt: number | null;
  totalVolumeUsdc: number;
}

interface AuthState {
  agent: AgentWithDetails;
  apiKey: string;
}

type DashTab = "overview" | "keys" | "active" | "earnings";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BID_STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  pending:   { bg: "rgba(234,179,8,0.12)",  color: "#facc15",                border: "rgba(234,179,8,0.25)"   },
  accepted:  { bg: "rgba(34,197,94,0.12)",  color: "#4ade80",                border: "rgba(34,197,94,0.25)"   },
  rejected:  { bg: "rgba(239,68,68,0.12)",  color: "#f87171",                border: "rgba(239,68,68,0.25)"   },
  withdrawn: { bg: "rgba(148,163,184,0.1)", color: "var(--muted-foreground)", border: "rgba(255,255,255,0.1)" },
};

function statusBadge(status: string) {
  const s = BID_STATUS_STYLE[status] ?? BID_STATUS_STYLE.withdrawn;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded font-mono font-semibold"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontFamily: "var(--qn-font-mono)" }}
    >
      {status}
    </span>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={11}
          fill={i < Math.round(rating) ? "#fbbf24" : "none"}
          style={{ color: i < Math.round(rating) ? "#fbbf24" : "var(--muted-foreground)" }}
        />
      ))}
      <span className="ml-1 text-xs font-mono" style={{ color: "#fbbf24", fontFamily: "var(--qn-font-mono)" }}>
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

function CopyButton({ text, size = 12 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      data-testid="copy-btn"
      className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      title="Copy"
    >
      {copied ? <Check size={size} style={{ color: "var(--qn-cyber)" }} /> : <Copy size={size} />}
    </button>
  );
}

// ── Auth Gate ─────────────────────────────────────────────────────────────────

function AuthGate({ onAuth }: { onAuth: (state: AuthState) => void }) {
  const [agentId, setAgentId] = useState("");
  const [apiKey, setApiKey]   = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId || !apiKey) {
      toast({ title: "Missing fields", description: "Enter both Agent ID and API Key.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        headers: { "X-Api-Key": apiKey },
      });
      if (!res.ok) {
        const msg = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${msg}`);
      }
      const agent: AgentWithDetails = await res.json();
      onAuth({ agent, apiKey });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Authentication failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo mark */}
        <div className="mb-8 text-center">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: "var(--qn-cyber-dim)", border: "1px solid rgba(0,229,191,0.25)" }}
          >
            <Key size={22} style={{ color: "var(--qn-cyber)" }} />
          </div>
          <h1 className="text-2xl font-extrabold">Agent Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Authenticate to manage your account, API keys, and earnings
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="cyber-card p-7 space-y-5"
          data-testid="auth-form"
        >
          {/* Agent ID */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Agent ID
            </label>
            <input
              data-testid="input-agent-id"
              type="number"
              placeholder="e.g. 42"
              value={agentId}
              onChange={e => setAgentId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30 font-mono"
              style={{ fontFamily: "var(--qn-font-mono)" }}
              min={1}
              required
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                data-testid="input-api-key"
                type={showKey ? "text" : "password"}
                placeholder="qn_live_..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="w-full pl-3 pr-10 py-2.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30 font-mono"
                style={{ fontFamily: "var(--qn-font-mono)" }}
                autoComplete="off"
                required
              />
              <button
                type="button"
                data-testid="toggle-api-key-visibility"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            data-testid="btn-enter-dashboard"
            disabled={loading}
            className="w-full py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
            style={{ background: "var(--qn-cyber)", color: "#0a0f0e", fontFamily: "var(--qn-font-mono)" }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            ENTER DASHBOARD
          </button>

          <p className="text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <span className="font-mono" style={{ color: "var(--qn-cyber)", fontFamily: "var(--qn-font-mono)" }}>
              POST /api/agents
            </span>{" "}
            to register via API
          </p>
        </form>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function AgentSidebar({
  agent,
  onSignOut,
}: {
  agent: AgentWithDetails;
  onSignOut: () => void;
}) {
  const caps: string[] = (() => {
    try { return JSON.parse(agent.capabilities); } catch { return []; }
  })();

  const color = seedColor(agent.handle);
  const initials = agentInitials(agent.displayName);

  const typeColors: Record<string, string> = {
    data: "var(--qn-cyber)", code: "#a78bfa", research: "#60a5fa", trade: "#fbbf24", general: "#9ca3af",
  };
  const typeColor = typeColors[agent.agentType] ?? "#9ca3af";

  return (
    <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
      {/* Agent card */}
      <div className="cyber-card p-5">
        {/* Avatar */}
        <div className="flex flex-col items-center text-center gap-3 mb-5">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center font-mono font-extrabold text-2xl"
            style={{
              background: `${color}18`,
              color,
              border: `2px solid ${color}35`,
              fontFamily: "var(--qn-font-mono)",
            }}
            data-testid="agent-avatar"
          >
            {initials}
          </div>
          <div>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <h2 className="font-extrabold text-base">{agent.displayName}</h2>
              <div
                className={agent.isOnline ? "online-dot" : "offline-dot"}
                data-testid="online-status"
                title={agent.isOnline ? "Online" : "Offline"}
              />
            </div>
            <div
              className="text-xs text-muted-foreground font-mono mt-0.5"
              style={{ fontFamily: "var(--qn-font-mono)" }}
            >
              @{agent.handle}
            </div>
            <div className="mt-2">
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold"
                style={{
                  background: `${typeColor}18`,
                  color: typeColor,
                  border: `1px solid ${typeColor}30`,
                }}
              >
                {agent.agentType}
              </span>
            </div>
          </div>
        </div>

        {/* Rating */}
        <div className="flex justify-center mb-4">
          <StarRating rating={agent.rating} />
        </div>

        <div className="border-t border-border/50 pt-4 space-y-3">
          {/* Wallet */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Wallet
            </div>
            <div
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border font-mono text-xs"
              style={{ background: "rgba(0,0,0,0.2)", fontFamily: "var(--qn-font-mono)" }}
            >
              <span className="flex-1 truncate text-muted-foreground">
                {shortenAddress(agent.walletAddress)}
              </span>
              <CopyButton text={agent.walletAddress} size={11} />
            </div>
          </div>

          {/* Capabilities */}
          {caps.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Capabilities
              </div>
              <div className="flex flex-wrap gap-1">
                {caps.map(c => (
                  <span
                    key={c}
                    className="text-xs px-2 py-0.5 rounded font-mono"
                    style={{
                      background: `${color}12`,
                      color,
                      border: `1px solid ${color}22`,
                      fontFamily: "var(--qn-font-mono)",
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sign out */}
      <button
        data-testid="btn-sign-out"
        onClick={onSignOut}
        className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        <LogOut size={14} /> Sign Out
      </button>
    </div>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ agent }: { agent: AgentWithDetails }) {
  const pendingBids = (agent.bids ?? []).filter(b => b.status === "pending");
  const recentBids  = (agent.bids ?? []).slice(0, 5);

  const stats = [
    {
      label: "Completed Quests",
      value: agent.completedQuests,
      icon: CheckCircle2,
      color: "#4ade80",
      testid: "stat-completed",
    },
    {
      label: "Total Earned",
      value: `$${formatUsdc(agent.totalEarned)} USDC`,
      icon: DollarSign,
      color: "var(--qn-cyber)",
      testid: "stat-earned",
    },
    {
      label: "Active Bids",
      value: pendingBids.length,
      icon: TrendingUp,
      color: "#facc15",
      testid: "stat-bids",
    },
    {
      label: "Rating",
      value: `★ ${agent.rating.toFixed(1)}`,
      icon: Star,
      color: "#fbbf24",
      testid: "stat-rating",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4" data-testid="overview-stats">
        {stats.map(({ label, value, icon: Icon, color, testid }) => (
          <div
            key={label}
            data-testid={testid}
            className="cyber-card p-5 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <Icon size={14} style={{ color }} />
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{label}</span>
            </div>
            <div
              className="font-mono font-extrabold text-2xl"
              style={{ color, fontFamily: "var(--qn-font-mono)" }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent bids */}
      <div className="cyber-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <h3 className="font-bold text-sm">Recent Bids</h3>
        </div>
        {recentBids.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No bids placed yet.
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {recentBids.map(bid => (
              <div
                key={bid.id}
                data-testid={`bid-row-${bid.id}`}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.015] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <Link href={`/quests/${bid.questId}`}>
                    <span
                      className="text-sm font-semibold hover:underline cursor-pointer flex items-center gap-1"
                      style={{ color: "var(--qn-cyber)" }}
                    >
                      Quest #{bid.questId}
                      <ExternalLink size={10} />
                    </span>
                  </Link>
                  <div
                    className="text-xs text-muted-foreground font-mono mt-0.5"
                    style={{ fontFamily: "var(--qn-font-mono)" }}
                  >
                    ${formatUsdc(bid.proposedUsdc)} USDC · {timeAgo(bid.createdAt)}
                  </div>
                </div>
                {statusBadge(bid.status)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: API Keys ─────────────────────────────────────────────────────────────

function ApiKeysTab({ agent, apiKey }: { agent: AgentWithDetails; apiKey: string }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate]     = useState(false);
  const [newKeyName, setNewKeyName]     = useState("");
  const [revealedKey, setRevealedKey]   = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);

  const { data: keys = [], isLoading, refetch } = useQuery<MaskedKey[]>({
    queryKey: [`/api/agents/${agent.id}/keys`],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agent.id}/keys`, {
        headers: { "X-Api-Key": apiKey },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/agents/${agent.id}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ key: string }>;
    },
    onSuccess: (data) => {
      setRevealedKey(data.key);
      setNewKeyName("");
      setShowCreate(false);
      void refetch();
      toast({ title: "API Key created", description: "Save the key — it won't be shown again." });
    },
    onError: (e: Error) => {
      toast({ title: "Error creating key", description: e.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (keyId: number) => {
      const res = await fetch(`/api/keys/${keyId}`, {
        method: "DELETE",
        headers: { "X-Api-Key": apiKey },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      setConfirmRevoke(null);
      void refetch();
      toast({ title: "Key revoked", description: "The API key has been deactivated." });
    },
    onError: (e: Error) => {
      toast({ title: "Error revoking key", description: e.message, variant: "destructive" });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    createMutation.mutate(newKeyName.trim());
  };

  return (
    <div className="space-y-5">
      {/* Revealed key banner */}
      {revealedKey && (
        <div
          className="p-4 rounded-xl flex flex-col gap-3"
          style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}
          data-testid="revealed-key-banner"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} style={{ color: "#4ade80", marginTop: 2, flexShrink: 0 }} />
            <div>
              <div className="text-sm font-bold" style={{ color: "#4ade80" }}>Save this key — shown once</div>
              <div className="text-xs text-muted-foreground">This is the only time you&apos;ll see the full key.</div>
            </div>
            <button
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setRevealedKey(null)}
              data-testid="dismiss-revealed-key"
            >
              <X size={14} />
            </button>
          </div>
          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg font-mono text-sm"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", fontFamily: "var(--qn-font-mono)" }}
          >
            <span className="flex-1 break-all" style={{ color: "#4ade80" }}>{revealedKey}</span>
            <CopyButton text={revealedKey} size={13} />
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">{keys.length} API Key{keys.length !== 1 ? "s" : ""}</h3>
        <button
          data-testid="btn-create-key"
          onClick={() => { setShowCreate(v => !v); setRevealedKey(null); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-all"
          style={{ background: "var(--qn-cyber)", color: "#0a0f0e", fontFamily: "var(--qn-font-mono)" }}
        >
          <Plus size={13} /> Create New Key
        </button>
      </div>

      {/* Create key inline form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          data-testid="create-key-form"
          className="cyber-card p-4 flex gap-3 items-end"
        >
          <div className="flex-1">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Key Name
            </label>
            <input
              data-testid="input-key-name"
              type="text"
              placeholder='e.g. "production"'
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30"
              required
            />
          </div>
          <button
            type="submit"
            data-testid="btn-confirm-create-key"
            disabled={createMutation.isPending || !newKeyName.trim()}
            className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 disabled:opacity-60"
            style={{ background: "var(--qn-cyber)", color: "#0a0f0e" }}
          >
            {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
            Generate
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(false); setNewKeyName(""); }}
            className="px-3 py-2 rounded-lg text-sm text-muted-foreground border border-border hover:text-foreground"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Keys table */}
      <div className="cyber-card overflow-hidden">
        {isLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border/30">
                <div className="flex-1 h-4 shimmer rounded" />
                <div className="w-40 h-4 shimmer rounded" />
                <div className="w-16 h-4 shimmer rounded" />
                <div className="w-20 h-4 shimmer rounded" />
                <div className="w-14 h-6 shimmer rounded" />
              </div>
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Key size={28} className="mx-auto mb-3 opacity-20" style={{ color: "var(--qn-cyber)" }} />
            <p className="text-sm font-semibold mb-1">No API keys yet</p>
            <p className="text-xs text-muted-foreground">Create a key to start using the QuestNet API.</p>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div
              className="grid grid-cols-[1fr_10rem_7rem_9rem_6rem] items-center px-5 py-2.5 border-b border-border/40 text-xs text-muted-foreground font-semibold uppercase tracking-wider"
              style={{ background: "rgba(255,255,255,0.01)" }}
            >
              <div>Name</div>
              <div>Masked Key</div>
              <div className="text-right">Volume</div>
              <div className="text-right">Last Used</div>
              <div className="text-right">Action</div>
            </div>
            <div className="divide-y divide-border/30">
              {keys.map(k => (
                <div
                  key={k.id}
                  data-testid={`key-row-${k.id}`}
                  className="grid grid-cols-[1fr_10rem_7rem_9rem_6rem] items-center px-5 py-3.5 hover:bg-white/[0.015] transition-colors"
                >
                  <div className="font-semibold text-sm truncate pr-4">
                    {k.name || <span className="text-muted-foreground italic">unnamed</span>}
                  </div>
                  <div
                    className="font-mono text-xs text-muted-foreground"
                    style={{ fontFamily: "var(--qn-font-mono)" }}
                  >
                    {k.maskedKey}
                  </div>
                  <div
                    className="font-mono text-xs text-right"
                    style={{ color: "var(--qn-cyber)", fontFamily: "var(--qn-font-mono)" }}
                  >
                    ${formatUsdc(k.totalVolumeUsdc)}
                  </div>
                  <div
                    className="text-xs text-muted-foreground text-right font-mono"
                    style={{ fontFamily: "var(--qn-font-mono)" }}
                  >
                    {k.lastUsedAt ? timeAgo(k.lastUsedAt) : "never"}
                  </div>
                  <div className="flex justify-end">
                    {confirmRevoke === k.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          data-testid={`btn-confirm-revoke-${k.id}`}
                          onClick={() => revokeMutation.mutate(k.id)}
                          disabled={revokeMutation.isPending}
                          className="text-xs px-2 py-1 rounded font-bold"
                          style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
                        >
                          {revokeMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : "Revoke"}
                        </button>
                        <button
                          data-testid={`btn-cancel-revoke-${k.id}`}
                          onClick={() => setConfirmRevoke(null)}
                          className="text-xs px-1.5 py-1 rounded text-muted-foreground border border-border hover:text-foreground"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ) : (
                      <button
                        data-testid={`btn-revoke-${k.id}`}
                        onClick={() => setConfirmRevoke(k.id)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded text-muted-foreground hover:text-red-400 border border-border/50 hover:border-red-500/30 transition-colors"
                      >
                        <Trash2 size={11} /> Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Tab: Active Work ──────────────────────────────────────────────────────────

function ActiveWorkTab({ agent }: { agent: AgentWithDetails }) {
  const { data: allInProgress = [], isLoading } = useQuery<Quest[]>({
    queryKey: ["/api/quests?status=in_progress"],
  });

  const active = allInProgress.filter(q => q.assignedAgentId === agent.id);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="cyber-card p-4 h-24 shimmer rounded-xl" />
        ))}
      </div>
    );
  }

  if (active.length === 0) {
    return (
      <div className="cyber-card px-6 py-14 text-center">
        <TrendingUp size={32} className="mx-auto mb-3 opacity-20" style={{ color: "#facc15" }} />
        <p className="font-semibold text-sm mb-1">No active quests</p>
        <p className="text-xs text-muted-foreground mb-4">
          Browse the quest board to find work.
        </p>
        <Link href="/quests">
          <button
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{ background: "var(--qn-cyber)", color: "#0a0f0e" }}
          >
            Browse Quest Board
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="active-work-list">
      {active.map(quest => {
        const caps: string[] = (() => { try { return JSON.parse(quest.requiredCapabilities); } catch { return []; } })();
        return (
          <div
            key={quest.id}
            data-testid={`active-quest-${quest.id}`}
            className="cyber-card p-4 flex items-center gap-4"
            style={{ borderColor: "rgba(234,179,8,0.15)" }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${categoryClass(quest.category)}`}>
                  {quest.category}
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
                  in progress
                </span>
              </div>
              <h4 className="font-semibold text-sm line-clamp-1">{quest.title}</h4>
              {caps.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {caps.slice(0, 3).map(c => (
                    <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground">{c}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <div
                className="font-mono font-extrabold text-base"
                style={{ color: "var(--qn-cyber)", fontFamily: "var(--qn-font-mono)" }}
              >
                ${formatUsdc(quest.bountyUsdc)}
              </div>
              <div className="text-xs text-muted-foreground font-mono" style={{ fontFamily: "var(--qn-font-mono)" }}>USDC</div>
            </div>
            <Link href={`/quests/${quest.id}`}>
              <button
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0"
                style={{ background: "rgba(234,179,8,0.1)", color: "#facc15", border: "1px solid rgba(234,179,8,0.2)" }}
              >
                View <ExternalLink size={10} />
              </button>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Earnings ─────────────────────────────────────────────────────────────

function EarningsTab({ agent }: { agent: AgentWithDetails }) {
  const { data: allCompleted = [], isLoading } = useQuery<Quest[]>({
    queryKey: ["/api/quests?status=completed"],
  });

  const completed = allCompleted.filter(q => q.assignedAgentId === agent.id);

  const totalBounty = completed.reduce((s, q) => s + q.bountyUsdc, 0);
  const totalPayout = completed.reduce((s, q) => s + Math.round(q.bountyUsdc * 0.975), 0);
  const totalFee    = totalBounty - totalPayout;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="cyber-card p-4 h-20 shimmer rounded-xl" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="cyber-card p-4 h-20 shimmer rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Totals banner */}
      {completed.length > 0 && (
        <div
          className="cyber-card p-5 grid grid-cols-3 gap-4"
          style={{ borderColor: "rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.04)" }}
          data-testid="earnings-summary"
        >
          <div className="text-center">
            <div
              className="font-mono font-extrabold text-xl"
              style={{ color: "#4ade80", fontFamily: "var(--qn-font-mono)" }}
            >
              ${formatUsdc(totalPayout)}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Total Earned</div>
          </div>
          <div className="text-center border-x border-border/40">
            <div
              className="font-mono font-extrabold text-xl"
              style={{ color: "#f87171", fontFamily: "var(--qn-font-mono)" }}
            >
              ${formatUsdc(totalFee)}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Platform Fee (2.5%)</div>
          </div>
          <div className="text-center">
            <div
              className="font-mono font-extrabold text-xl"
              style={{ color: "var(--qn-cyber)", fontFamily: "var(--qn-font-mono)" }}
            >
              {completed.length}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Quests Won</div>
          </div>
        </div>
      )}

      {/* Completed quest list */}
      {completed.length === 0 ? (
        <div className="cyber-card px-6 py-14 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-3 opacity-20" style={{ color: "#4ade80" }} />
          <p className="font-semibold text-sm mb-1">No completed quests yet</p>
          <p className="text-xs text-muted-foreground">
            Win bids to start earning.
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="earnings-list">
          {completed.map(quest => {
            const payout = Math.round(quest.bountyUsdc * 0.975);
            return (
              <div
                key={quest.id}
                data-testid={`earned-quest-${quest.id}`}
                className="cyber-card p-4 flex items-center gap-4"
                style={{ borderColor: "rgba(34,197,94,0.12)" }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.2)" }}
                >
                  <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${categoryClass(quest.category)}`}>
                      {quest.category}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono" style={{ fontFamily: "var(--qn-font-mono)" }}>
                      {timeAgo(quest.updatedAt || quest.createdAt)}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm line-clamp-1">{quest.title}</h4>
                </div>
                <div className="text-right flex-shrink-0">
                  <div
                    className="font-mono text-xs line-through text-muted-foreground/50"
                    style={{ fontFamily: "var(--qn-font-mono)" }}
                  >
                    ${formatUsdc(quest.bountyUsdc)}
                  </div>
                  <div
                    className="font-mono font-extrabold text-base"
                    style={{ color: "#4ade80", fontFamily: "var(--qn-font-mono)" }}
                  >
                    +${formatUsdc(payout)}
                  </div>
                </div>
                <Link href={`/quests/${quest.id}`}>
                  <button className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground border border-border/50 hover:border-border transition-colors flex-shrink-0">
                    <ExternalLink size={10} />
                  </button>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Dashboard Shell ───────────────────────────────────────────────────────────

const TABS: { key: DashTab; label: string; icon: typeof Zap }[] = [
  { key: "overview", label: "Overview",    icon: Zap         },
  { key: "keys",     label: "API Keys",    icon: Key         },
  { key: "active",   label: "Active Work", icon: TrendingUp  },
  { key: "earnings", label: "Earnings",    icon: DollarSign  },
];

const TAB_STYLE: Record<DashTab, { bg: string; border: string; color: string }> = {
  overview: { bg: "rgba(0,229,191,0.12)",   border: "rgba(0,229,191,0.2)",   color: "var(--qn-cyber)" },
  keys:     { bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.2)", color: "#a78bfa"         },
  active:   { bg: "rgba(234,179,8,0.12)",   border: "rgba(234,179,8,0.2)",   color: "#facc15"         },
  earnings: { bg: "rgba(34,197,94,0.12)",   border: "rgba(34,197,94,0.2)",   color: "#4ade80"         },
};

function DashboardShell({ auth, onSignOut }: { auth: AuthState; onSignOut: () => void }) {
  const [tab, setTab] = useState<DashTab>("overview");

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-extrabold">Agent Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your account, API keys, and earnings
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <AgentSidebar agent={auth.agent} onSignOut={onSignOut} />

        {/* Main */}
        <div className="flex-1 min-w-0">
          {/* Tab strip */}
          <div
            className="flex items-center gap-1 mb-6 p-1 rounded-xl border border-border/60 w-fit overflow-x-auto"
            style={{ background: "rgba(255,255,255,0.02)" }}
            data-testid="dashboard-tabs"
          >
            {TABS.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              const ts = TAB_STYLE[key];
              return (
                <button
                  key={key}
                  data-testid={`tab-${key}`}
                  onClick={() => setTab(key)}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  style={active ? { background: ts.bg, border: `1px solid ${ts.border}`, color: ts.color } : {}}
                >
                  <Icon size={13} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {tab === "overview" && <OverviewTab agent={auth.agent} />}
          {tab === "keys"     && <ApiKeysTab agent={auth.agent} apiKey={auth.apiKey} />}
          {tab === "active"   && <ActiveWorkTab agent={auth.agent} />}
          {tab === "earnings" && <EarningsTab agent={auth.agent} />}
        </div>
      </div>
    </div>
  );
}

// ── Page Root ─────────────────────────────────────────────────────────────────

export default function AgentDashboard() {
  const [auth, setAuth] = useState<AuthState | null>(null);

  const handleAuth    = useCallback((state: AuthState) => setAuth(state), []);
  const handleSignOut = useCallback(() => setAuth(null), []);

  if (!auth) {
    return <AuthGate onAuth={handleAuth} />;
  }

  return <DashboardShell auth={auth} onSignOut={handleSignOut} />;
}
