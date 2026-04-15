import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Search, SlidersHorizontal, Zap, Clock, Eye } from "lucide-react";
import { formatUsdc, categoryClass, priorityClass, timeAgo, formatDeadline, CATEGORIES } from "@/lib/utils";
import type { Quest } from "@shared/schema";

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

        {/* Capabilities required */}
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

export default function QuestBoard() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('open');

  const params = new URLSearchParams();
  if (category !== 'all') params.set('category', category);
  if (status !== 'all') params.set('status', status);
  if (search) params.set('search', search);
  const queryString = params.toString();

  const questUrl = `/api/quests${queryString ? '?' + queryString : ''}`;
  const { data: quests, isLoading } = useQuery<Quest[]>({
    queryKey: [questUrl],
  });

  const totalBounty = quests?.reduce((s, q) => s + q.bountyUsdc, 0) ?? 0;

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold mb-1">Quest Board</h1>
        <p className="text-sm text-muted-foreground">
          {quests?.length ?? '...'} quests · <span style={{ color: 'var(--qn-cyber)' }}>${formatUsdc(totalBounty)} USDC</span> total bounty available
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="input-search"
            type="text"
            placeholder="Search quests..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30"
          />
        </div>

        {/* Category */}
        <select
          data-testid="select-category"
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30 min-w-[140px]"
        >
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        {/* Status */}
        <select
          data-testid="select-status"
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30 min-w-[120px]"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>

        <Link href="/post">
          <button className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 flex-shrink-0"
            style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}>
            <Zap size={12} /> POST QUEST
          </button>
        </Link>
      </div>

      {/* Category quick pills */}
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

      {/* Quest grid */}
      {isLoading ? (
        <div className="quest-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="cyber-card p-5 h-52 shimmer rounded-xl" />
          ))}
        </div>
      ) : quests?.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3 font-mono" style={{ color: 'var(--qn-cyber-dim)', fontFamily: 'var(--qn-font-mono)' }}>∅</div>
          <h3 className="font-bold mb-1">No quests found</h3>
          <p className="text-sm text-muted-foreground mb-4">Try different filters or post the first quest in this category.</p>
          <Link href="/post">
            <button className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: 'var(--qn-cyber)', color: '#0a0f0e' }}>
              Post a Quest
            </button>
          </Link>
        </div>
      ) : (
        <div className="quest-grid">
          {quests?.map(q => <QuestCard key={q.id} quest={q} />)}
        </div>
      )}
    </div>
  );
}
