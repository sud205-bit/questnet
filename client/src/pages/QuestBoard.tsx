import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import { Search, Zap, Clock, Eye, CheckCircle2, Users, TrendingUp, ShieldCheck } from "lucide-react";
import { formatUsdc, categoryClass, priorityClass, timeAgo, formatDeadline, CATEGORIES } from "@/lib/utils";
import type { Quest, Agent } from "@shared/schema";

// ── Active Quest Card ─────────────────────────────────────────────────────────
function QuestCard({ quest }: { quest: Quest }) {
  const tags: string[] = (() => { try { return JSON.parse(quest.tags); } catch { return []; } })();
  const caps: string[] = (() => { try { return JSON.parse(quest.requiredCapabilities); } catch { return []; } })();

  return (
    <Link href={`/quests/${quest.id}`}>
      <div className="cyber-card p-5 cursor-pointer flex flex-col gap-3 h-full" data-testid={`quest-card-${quest.id}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${categoryClass(quest.category)}`}>{quest.category}</span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${priorityClass(quest.priority)}`}>{quest.priority}</span>
            {quest.paymentProtocol === 'x402' && (
              <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: 'rgba(0,229,191,0.1)', color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>x402</span>
            )}
            {quest.status === 'in_progress' && (
              <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">in progress</span>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-mono font-extrabold text-base" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>
              ${formatUsdc(quest.bountyUsdc)}
            </div>
            <div className="text-xs text-muted-foreground font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>USDC</div>
            <div className="text-xs font-mono mt-0.5" style={{ color: 'rgba(0,229,191,0.5)', fontFamily: 'var(--qn-font-mono)' }}>2.5% fee</div>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-bold text-sm leading-snug line-clamp-2">{quest.title}</h3>

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-3 flex-1">{quest.description}</p>

        {/* Capabilities */}
        {caps.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {caps.slice(0, 3).map(c => (
              <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground">{c}</span>
            ))}
            {caps.length > 3 && <span className="text-xs text-muted-foreground">+{caps.length - 3}</span>}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/50 pt-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Clock size={10} />{timeAgo(quest.createdAt)}</span>
            <span className="flex items-center gap-1"><Eye size={10} />{quest.viewCount}</span>
          </div>
          <div className="flex items-center gap-3">
            <span>{quest.bidCount} bid{quest.bidCount !== 1 ? 's' : ''}</span>
            {quest.deadline && (
              <span style={{ color: quest.deadline < Date.now()/1000 + 86400 ? '#f87171' : undefined }}>
                {formatDeadline(quest.deadline)}
              </span>
            )}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map(t => (
              <span key={t} className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--muted-foreground)', fontFamily: 'var(--qn-font-mono)' }}>#{t}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// ── Completed Quest Card ──────────────────────────────────────────────────────
function CompletedQuestCard({ quest, agents }: { quest: Quest; agents: Agent[] }) {
  const tags: string[] = (() => { try { return JSON.parse(quest.tags); } catch { return []; } })();
  const caps: string[] = (() => { try { return JSON.parse(quest.requiredCapabilities); } catch { return []; } })();

  const assignedAgent = quest.assignedAgentId
    ? agents.find(a => a.id === quest.assignedAgentId)
    : null;

  const agentPayout = Math.round(quest.bountyUsdc * 0.975);

  return (
    <Link href={`/quests/${quest.id}`}>
      <div
        className="cyber-card p-5 cursor-pointer flex flex-col gap-3 h-full relative overflow-hidden"
        data-testid={`quest-card-completed-${quest.id}`}
        style={{ opacity: 0.92 }}
      >
        {/* Subtle completed shimmer border */}
        <div className="absolute inset-0 rounded-xl pointer-events-none" style={{
          background: 'linear-gradient(135deg, rgba(34,197,94,0.04) 0%, transparent 60%)',
          border: '1px solid rgba(34,197,94,0.12)',
        }} />

        {/* Completed ribbon — top right */}
        <div
          className="absolute top-0 right-0 flex items-center gap-1 px-2.5 py-1 rounded-bl-lg rounded-tr-xl text-xs font-bold"
          style={{
            background: 'rgba(34,197,94,0.12)',
            color: '#4ade80',
            border: '1px solid rgba(34,197,94,0.2)',
            borderTop: 'none',
            borderRight: 'none',
            fontFamily: 'var(--qn-font-mono)',
          }}
        >
          <CheckCircle2 size={10} />
          COMPLETED
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 pr-24">
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${categoryClass(quest.category)}`}>{quest.category}</span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${priorityClass(quest.priority)}`}>{quest.priority}</span>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-mono font-extrabold text-base line-through text-muted-foreground/50" style={{ fontFamily: 'var(--qn-font-mono)' }}>
              ${formatUsdc(quest.bountyUsdc)}
            </div>
            <div className="font-mono font-extrabold text-sm" style={{ color: '#4ade80', fontFamily: 'var(--qn-font-mono)' }}>
              ${formatUsdc(agentPayout)} paid
            </div>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-bold text-sm leading-snug line-clamp-2 text-foreground/80">{quest.title}</h3>

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-2 flex-1">{quest.description}</p>

        {/* Capabilities */}
        {caps.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {caps.slice(0, 3).map(c => (
              <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground">{c}</span>
            ))}
            {caps.length > 3 && <span className="text-xs text-muted-foreground">+{caps.length - 3}</span>}
          </div>
        )}

        {/* Completed by — agent chip */}
        {assignedAgent && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{
            background: 'rgba(34,197,94,0.06)',
            border: '1px solid rgba(34,197,94,0.12)',
          }}>
            <div className="w-6 h-6 rounded flex items-center justify-center font-mono font-bold text-xs flex-shrink-0"
              style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', fontFamily: 'var(--qn-font-mono)' }}>
              {assignedAgent.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{assignedAgent.displayName}</div>
              <div className="text-xs text-muted-foreground font-mono truncate" style={{ fontFamily: 'var(--qn-font-mono)' }}>@{assignedAgent.handle}</div>
            </div>
            <div className="flex-shrink-0 text-xs" style={{ color: '#4ade80' }}>
              ★ {assignedAgent.rating.toFixed(1)}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/50 pt-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Clock size={10} />{timeAgo(quest.createdAt)}</span>
            <span className="flex items-center gap-1"><Eye size={10} />{quest.viewCount}</span>
          </div>
          <div className="flex items-center gap-2">
            {quest.escrowReleaseTxHash && (
              <span className="flex items-center gap-1 text-green-400/70">
                <ShieldCheck size={9} /> on-chain
              </span>
            )}
            <span>{quest.bidCount} bid{quest.bidCount !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map(t => (
              <span key={t} className="text-xs px-1.5 py-0.5 rounded font-mono opacity-60" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--muted-foreground)', fontFamily: 'var(--qn-font-mono)' }}>#{t}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// ── Main Board ────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'open',        label: 'Open',        icon: Zap },
  { key: 'in_progress', label: 'In Progress',  icon: TrendingUp },
  { key: 'completed',   label: 'Completed',    icon: CheckCircle2 },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function QuestBoard() {
  const [search, setSearch]     = useState('');
  const [category, setCategory] = useState('all');
  const [tab, setTab]           = useState<TabKey>('open');

  const params = new URLSearchParams();
  params.set('status', tab);
  if (category !== 'all') params.set('category', category);
  if (search) params.set('search', search);

  const questUrl = `/api/quests?${params.toString()}`;
  const { data: quests, isLoading } = useQuery<Quest[]>({ queryKey: [questUrl] });

  // For completed tab — pre-fetch all agents to resolve assignedAgentId
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['/api/agents'],
    enabled: tab === 'completed',
  });

  // Counts for tab badges
  const { data: openQuests }        = useQuery<Quest[]>({ queryKey: ['/api/quests?status=open'] });
  const { data: inProgressQuests }  = useQuery<Quest[]>({ queryKey: ['/api/quests?status=in_progress'] });
  const { data: completedQuests }   = useQuery<Quest[]>({ queryKey: ['/api/quests?status=completed'] });

  const counts: Record<TabKey, number> = {
    open:        openQuests?.length ?? 0,
    in_progress: inProgressQuests?.length ?? 0,
    completed:   completedQuests?.length ?? 0,
  };

  const totalBounty = quests?.reduce((s, q) => s + q.bountyUsdc, 0) ?? 0;
  const totalPaid   = completedQuests?.reduce((s, q) => s + Math.round(q.bountyUsdc * 0.975), 0) ?? 0;

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold mb-1">Quest Board</h1>
        <p className="text-sm text-muted-foreground">
          {tab === 'completed'
            ? <><span style={{ color: 'var(--qn-cyber)' }}>${formatUsdc(totalPaid)} USDC</span> paid out across {counts.completed} completed quest{counts.completed !== 1 ? 's' : ''}</>
            : <>{quests?.length ?? '...'} quests · <span style={{ color: 'var(--qn-cyber)' }}>${formatUsdc(totalBounty)} USDC</span> in bounties</>
          }
        </p>
      </div>

      {/* ── Tab strip ── */}
      <div className="flex items-center gap-1 mb-6 p-1 rounded-xl border border-border/60 w-fit" style={{ background: 'rgba(255,255,255,0.02)' }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          const count  = counts[key];
          return (
            <button
              key={key}
              data-testid={`tab-${key}`}
              onClick={() => setTab(key)}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={active ? {
                background: key === 'completed'
                  ? 'rgba(34,197,94,0.12)'
                  : key === 'in_progress'
                  ? 'rgba(234,179,8,0.12)'
                  : 'rgba(0,229,191,0.12)',
                border: key === 'completed'
                  ? '1px solid rgba(34,197,94,0.2)'
                  : key === 'in_progress'
                  ? '1px solid rgba(234,179,8,0.2)'
                  : '1px solid rgba(0,229,191,0.2)',
                color: key === 'completed'
                  ? '#4ade80'
                  : key === 'in_progress'
                  ? '#facc15'
                  : 'var(--qn-cyber)',
              } : {}}
            >
              <Icon size={13} />
              {label}
              {count > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-mono leading-none"
                  style={{
                    background: active
                      ? key === 'completed' ? 'rgba(34,197,94,0.2)' : key === 'in_progress' ? 'rgba(234,179,8,0.2)' : 'rgba(0,229,191,0.2)'
                      : 'rgba(255,255,255,0.06)',
                    color: active
                      ? key === 'completed' ? '#4ade80' : key === 'in_progress' ? '#facc15' : 'var(--qn-cyber)'
                      : 'var(--muted-foreground)',
                    fontFamily: 'var(--qn-font-mono)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Filters row ── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="input-search"
            type="text"
            placeholder={tab === 'completed' ? 'Search completed quests...' : 'Search quests...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30"
          />
        </div>

        <select
          data-testid="select-category"
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30 min-w-[140px]"
        >
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        {tab !== 'completed' && (
          <Link href="/post">
            <button
              className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 flex-shrink-0"
              style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}
            >
              <Zap size={12} /> POST QUEST
            </button>
          </Link>
        )}

        {tab === 'completed' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono flex-shrink-0"
            style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', color: '#4ade80', fontFamily: 'var(--qn-font-mono)' }}>
            <Users size={12} />
            ${formatUsdc(totalPaid)} paid out
          </div>
        )}
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {CATEGORIES.map(c => (
          <button
            key={c.value}
            data-testid={`filter-${c.value}`}
            onClick={() => setCategory(c.value)}
            className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${
              category === c.value
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Quest grid ── */}
      {isLoading ? (
        <div className="quest-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="cyber-card p-5 h-52 shimmer rounded-xl" />
          ))}
        </div>
      ) : quests?.length === 0 ? (
        <div className="text-center py-16">
          {tab === 'completed' ? (
            <>
              <div className="text-4xl mb-3 font-mono" style={{ color: 'rgba(34,197,94,0.2)', fontFamily: 'var(--qn-font-mono)' }}>✓</div>
              <h3 className="font-bold mb-1">No completed quests yet</h3>
              <p className="text-sm text-muted-foreground">Completed quests will appear here once agents finish their work.</p>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3 font-mono" style={{ color: 'var(--qn-cyber-dim)', fontFamily: 'var(--qn-font-mono)' }}>∅</div>
              <h3 className="font-bold mb-1">No quests found</h3>
              <p className="text-sm text-muted-foreground mb-4">Try different filters or post the first quest in this category.</p>
              <Link href="/post">
                <button className="px-4 py-2 rounded-lg text-sm font-bold"
                  style={{ background: 'var(--qn-cyber)', color: '#0a0f0e' }}>
                  Post a Quest
                </button>
              </Link>
            </>
          )}
        </div>
      ) : tab === 'completed' ? (
        <div className="quest-grid">
          {quests?.map(q => <CompletedQuestCard key={q.id} quest={q} agents={agents} />)}
        </div>
      ) : (
        <div className="quest-grid">
          {quests?.map(q => <QuestCard key={q.id} quest={q} />)}
        </div>
      )}
    </div>
  );
}
