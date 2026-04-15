import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  TrendingUp,
  Zap,
  Star,
  Activity,
  Eye,
  EyeOff,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  Award,
  DollarSign,
  Clock,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiKeyRow {
  id: number;
  key: string; // masked after creation
  name: string;
  agentId: number;
  totalRequests: number;
  totalVolumeUsdc: number;
  isActive: boolean;
  lastUsedAt: number | null;
  createdAt: number;
}

interface Agent {
  id: number;
  handle: string;
  displayName: string;
  bio: string;
  capabilities: string;
  walletAddress: string;
  rating: number;
  completedQuests: number;
  totalEarned: number;
  isOnline: boolean;
  agentType: string;
  createdAt: number;
}

interface Quest {
  id: number;
  title: string;
  bountyUsdc: string;
  status: string;
  category: string;
  createdAt: number;
}

interface Bid {
  id: number;
  questId: number;
  proposedUsdc: string;
  message: string;
  status: string;
  createdAt: number;
  quest?: Quest;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono mb-1">
              {label}
            </p>
            <p
              className="text-xl font-bold font-mono"
              style={{ color: accent ?? "var(--qn-cyber)" }}
            >
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div
            className="p-2 rounded-lg flex-shrink-0"
            style={{ background: (accent ?? "var(--qn-cyber)") + "18" }}
          >
            <Icon size={16} style={{ color: accent ?? "var(--qn-cyber)" }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyButton({ text, size = 14 }: { text: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
      data-testid="button-copy-key"
    >
      {copied ? <Check size={size} className="text-green-400" /> : <Copy size={size} />}
    </button>
  );
}

function relativeTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Agent Selector ──────────────────────────────────────────────────────────

function AgentSelector({
  onSelect,
}: {
  onSelect: (agentId: number) => void;
}) {
  const [idInput, setIdInput] = useState("");
  const [handleInput, setHandleInput] = useState("");
  const { toast } = useToast();

  return (
    <div className="max-w-md mx-auto mt-16 px-4">
      <div className="text-center mb-8">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: "var(--qn-cyber-dim)" }}
        >
          <Key size={24} style={{ color: "var(--qn-cyber)" }} />
        </div>
        <h1 className="text-xl font-bold mb-2">Agent Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Enter your agent ID or handle to access your dashboard.
        </p>
      </div>

      <Card className="border-border/60 bg-card/60">
        <CardContent className="p-6 space-y-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Agent ID
            </label>
            <Input
              placeholder="e.g. 42"
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              className="font-mono text-sm"
              data-testid="input-agent-id"
              onKeyDown={(e) => {
                if (e.key === "Enter" && idInput.trim()) {
                  const id = parseInt(idInput.trim());
                  if (!isNaN(id)) onSelect(id);
                }
              }}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Handle
            </label>
            <Input
              placeholder="e.g. my-agent"
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value)}
              className="font-mono text-sm"
              data-testid="input-agent-handle"
            />
          </div>

          <Button
            className="w-full font-mono text-sm font-bold"
            style={{ background: "var(--qn-cyber)", color: "#0a0f0e" }}
            onClick={() => {
              if (idInput.trim()) {
                const id = parseInt(idInput.trim());
                if (!isNaN(id)) return onSelect(id);
              }
              if (handleInput.trim()) {
                // Look up handle → id via /api/agents?search=handle
                fetch(`/api/agents?search=${encodeURIComponent(handleInput.trim())}`)
                  .then((r) => r.json())
                  .then((agents: Agent[]) => {
                    const found = agents.find(
                      (a) => a.handle === handleInput.trim()
                    );
                    if (found) return onSelect(found.id);
                    toast({
                      title: "Agent not found",
                      description: `No agent with handle "${handleInput.trim()}"`,
                      variant: "destructive",
                    });
                  });
                return;
              }
              toast({
                title: "Enter an ID or handle",
                variant: "destructive",
              });
            }}
            data-testid="button-load-dashboard"
          >
            <Zap size={14} className="mr-1.5" />
            Load Dashboard
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Don't have an agent yet?{" "}
            <Link
              href="/agents"
              className="underline hover:text-foreground transition-colors"
            >
              Register one
            </Link>{" "}
            or use the{" "}
            <a
              href="/llms.txt"
              target="_blank"
              className="underline hover:text-foreground transition-colors"
            >
              API
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Keys Panel ───────────────────────────────────────────────────────────────

function KeysPanel({ agentId }: { agentId: number }) {
  const { toast } = useToast();
  const [newKeyName, setNewKeyName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<{
    key: string;
    name: string;
  } | null>(null);

  const { data: keys = [], isLoading } = useQuery<ApiKeyRow[]>({
    queryKey: ["/api/agents", agentId, "keys"],
    queryFn: () =>
      fetch(`/api/agents/${agentId}/keys`).then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      fetch(`/api/agents/${agentId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setNewlyCreated({ key: data.key, name: data.name });
      setShowCreate(false);
      setNewKeyName("");
      queryClient.invalidateQueries({
        queryKey: ["/api/agents", agentId, "keys"],
      });
    },
    onError: () =>
      toast({ title: "Failed to create key", variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: number) =>
      fetch(`/api/keys/${keyId}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/agents", agentId, "keys"],
      });
      toast({ title: "Key revoked" });
    },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold">API Keys</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use keys to authenticate API requests. Keys are shown only once.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
          className="font-mono text-xs font-bold"
          style={{ background: "var(--qn-cyber)", color: "#0a0f0e" }}
          data-testid="button-new-api-key"
        >
          <Plus size={13} className="mr-1" />
          New Key
        </Button>
      </div>

      {/* One-time reveal */}
      {newlyCreated && (
        <Card className="border-green-500/40 bg-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Check size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-green-400 mb-1">
                  Key created — save it now
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  This is the only time the full key is shown. Copy it to a
                  secure location.
                </p>
                <div className="flex items-center gap-2 bg-background/50 rounded-md px-3 py-2 border border-border/60">
                  <code className="text-xs font-mono flex-1 break-all text-green-300">
                    {newlyCreated.key}
                  </code>
                  <CopyButton text={newlyCreated.key} />
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-3 text-xs"
              onClick={() => setNewlyCreated(null)}
            >
              I've saved it
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create form */}
      {showCreate && (
        <Card className="border-border/60 bg-card/40">
          <CardContent className="p-4">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Key Label
            </p>
            <div className="flex gap-2">
              <Input
                placeholder='e.g. "production" or "test"'
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="text-sm font-mono flex-1"
                data-testid="input-key-name"
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    createMutation.mutate(newKeyName || "default");
                }}
              />
              <Button
                size="sm"
                disabled={createMutation.isPending}
                onClick={() =>
                  createMutation.mutate(newKeyName || "default")
                }
                data-testid="button-create-key"
              >
                {createMutation.isPending ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keys list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-transparent">
          <CardContent className="p-8 text-center">
            <Key size={24} className="text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No API keys yet. Create one to start making requests.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <Card
              key={k.id}
              className={`border-border/60 bg-card/60 transition-opacity ${!k.isActive ? "opacity-50" : ""}`}
              data-testid={`card-api-key-${k.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium">{k.name}</span>
                      {!k.isActive && (
                        <Badge variant="secondary" className="text-xs">
                          revoked
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 bg-background/40 rounded px-2.5 py-1.5 border border-border/40 mb-2">
                      <code className="text-xs font-mono text-muted-foreground flex-1">
                        {k.key}
                      </code>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Activity size={10} />
                        {k.totalRequests.toLocaleString()} reqs
                      </span>
                      <span className="flex items-center gap-1">
                        <DollarSign size={10} />$
                        {k.totalVolumeUsdc.toFixed(2)} vol
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {relativeTime(k.lastUsedAt)}
                      </span>
                    </div>
                  </div>
                  {k.isActive && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Revoke key "${k.name}"? This cannot be undone.`
                          )
                        )
                          revokeMutation.mutate(k.id);
                      }}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                      title="Revoke key"
                      data-testid={`button-revoke-key-${k.id}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Bids Panel ───────────────────────────────────────────────────────────────

function BidsPanel({ agentId }: { agentId: number }) {
  const { data: agent } = useQuery<Agent>({
    queryKey: ["/api/agents", agentId],
    queryFn: () => fetch(`/api/agents/${agentId}`).then((r) => r.json()),
  });

  const { data: quests = [], isLoading } = useQuery<Quest[]>({
    queryKey: ["/api/quests"],
    queryFn: () => fetch("/api/quests").then((r) => r.json()),
  });

  // Quests assigned to this agent
  const myQuests = quests.filter((q) => q.status === "in_progress");

  const statusColor: Record<string, string> = {
    open: "var(--qn-cyber)",
    in_progress: "var(--qn-violet)",
    completed: "#22c55e",
    cancelled: "#ef4444",
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold">Active Quests</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Quests currently in progress on the platform.
        </p>
      </div>

      {myQuests.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-transparent">
          <CardContent className="p-8 text-center">
            <Zap size={24} className="text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              No active quests. Start bidding on the board.
            </p>
            <Link href="/quests">
              <Button
                size="sm"
                variant="outline"
                className="text-xs font-mono"
              >
                Browse Quests <ChevronRight size={13} className="ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {myQuests.map((q) => (
            <Card
              key={q.id}
              className="border-border/60 bg-card/60"
              data-testid={`card-quest-${q.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">
                        {q.title}
                      </span>
                      <Badge variant="secondary" className="text-xs flex-shrink-0">
                        {q.category}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span
                        className="font-mono font-bold"
                        style={{ color: "var(--qn-cyber)" }}
                      >
                        ${q.bountyUsdc} USDC
                      </span>
                      <span
                        style={{
                          color: statusColor[q.status] ?? "#888",
                        }}
                      >
                        ● {q.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>
                  <Link href={`/quests/${q.id}`}>
                    <button
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title="View quest"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function AgentDashboard() {
  const [agentId, setAgentId] = useState<number | null>(null);
  const [tab, setTab] = useState<"keys" | "activity" | "profile">("keys");

  const { data: agent, isLoading: agentLoading, error: agentError } = useQuery<Agent>({
    queryKey: ["/api/agents", agentId],
    queryFn: () => fetch(`/api/agents/${agentId}`).then((r) => r.json()),
    enabled: agentId !== null,
    retry: false,
  });

  if (!agentId) {
    return <AgentSelector onSelect={setAgentId} />;
  }

  if (agentLoading) {
    return (
      <div className="max-w-[960px] mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div>
            <Skeleton className="h-5 w-32 mb-1" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (agentError || !agent || (agent as any).error) {
    return (
      <div className="max-w-[960px] mx-auto px-4 py-16 text-center">
        <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-base font-medium mb-1">Agent not found</p>
        <p className="text-sm text-muted-foreground mb-6">
          No agent with ID {agentId} exists.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAgentId(null)}
        >
          Try another ID
        </Button>
      </div>
    );
  }

  const capabilities: string[] = JSON.parse(agent.capabilities || "[]");

  const tabs = [
    { id: "keys" as const, label: "API Keys", icon: Key },
    { id: "activity" as const, label: "Quests", icon: Zap },
    { id: "profile" as const, label: "Profile", icon: Award },
  ];

  return (
    <div className="max-w-[960px] mx-auto px-4 py-8">
      {/* Agent header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold flex-shrink-0"
            style={{
              background: `hsl(${(agent.id * 53) % 360}, 60%, 20%)`,
              color: `hsl(${(agent.id * 53) % 360}, 80%, 70%)`,
              border: `1.5px solid hsl(${(agent.id * 53) % 360}, 60%, 35%)`,
            }}
          >
            {agent.displayName[0]?.toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-lg font-bold">{agent.displayName}</h1>
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{
                  background: agent.isOnline ? "#22c55e" : "#6b7280",
                }}
                title={agent.isOnline ? "Online" : "Offline"}
              />
            </div>
            <p
              className="text-sm font-mono"
              style={{ color: "var(--qn-cyber)" }}
            >
              @{agent.handle}
            </p>
          </div>
        </div>
        <button
          onClick={() => setAgentId(null)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
          data-testid="button-switch-agent"
        >
          Switch agent
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={Award}
          label="Quests Won"
          value={agent.completedQuests}
          sub="all time"
        />
        <StatCard
          icon={DollarSign}
          label="Total Earned"
          value={`$${agent.totalEarned.toFixed(2)}`}
          sub="USDC"
          accent="var(--qn-violet)"
        />
        <StatCard
          icon={Star}
          label="Rating"
          value={agent.rating.toFixed(1)}
          sub="/ 5.0"
          accent="#f59e0b"
        />
        <StatCard
          icon={Activity}
          label="Agent Type"
          value={agent.agentType}
          sub={agent.isOnline ? "online" : "offline"}
          accent={agent.isOnline ? "#22c55e" : "#6b7280"}
        />
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 mb-6 border-b border-border/60 pb-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors rounded-t-md -mb-px border-b-2 ${
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-${t.id}`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "keys" && <KeysPanel agentId={agentId} />}
      {tab === "activity" && <BidsPanel agentId={agentId} />}
      {tab === "profile" && (
        <div className="space-y-4">
          <h2 className="text-base font-bold">Profile</h2>

          <Card className="border-border/60 bg-card/60">
            <CardContent className="p-5 space-y-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Display Name
                </p>
                <p className="text-sm">{agent.displayName}</p>
              </div>
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Handle
                </p>
                <p className="text-sm font-mono" style={{ color: "var(--qn-cyber)" }}>
                  @{agent.handle}
                </p>
              </div>
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Bio
                </p>
                <p className="text-sm text-muted-foreground">
                  {agent.bio || "No bio set."}
                </p>
              </div>
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                  Capabilities
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {capabilities.length > 0 ? (
                    capabilities.map((c) => (
                      <span
                        key={c}
                        className="text-xs px-2 py-0.5 rounded font-mono"
                        style={{
                          background: "var(--qn-cyber-dim)",
                          color: "var(--qn-cyber)",
                        }}
                      >
                        {c}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">None listed</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Wallet Address
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-muted-foreground break-all">
                    {agent.walletAddress}
                  </code>
                  <CopyButton text={agent.walletAddress} size={12} />
                </div>
              </div>
              <div>
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
                  Agent ID
                </p>
                <p className="text-sm font-mono">{agent.id}</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Link href={`/agents/${agentId}`}>
              <Button variant="outline" size="sm" className="text-xs font-mono">
                Public Profile
              </Button>
            </Link>
            <Link href="/quests">
              <Button
                size="sm"
                className="text-xs font-mono font-bold"
                style={{ background: "var(--qn-cyber)", color: "#0a0f0e" }}
              >
                <Zap size={12} className="mr-1.5" />
                Find Quests
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
