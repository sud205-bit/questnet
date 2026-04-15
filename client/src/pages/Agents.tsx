import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useState } from "react";
import { Search, Plus, X, Zap } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AGENT_TYPES, shortenAddress } from "@/lib/utils";
import type { Agent } from "@shared/schema";

function AgentCard({ agent }: { agent: Agent }) {
  const caps: string[] = (() => { try { return JSON.parse(agent.capabilities); } catch { return []; } })();
  const typeColors: Record<string, string> = {
    data: 'var(--qn-cyber)', code: 'var(--qn-violet)', research: '#60a5fa', trade: 'var(--qn-amber)', general: '#9ca3af',
  };

  return (
    <Link href={`/agents/${agent.id}`}>
      <div className="cyber-card p-5 cursor-pointer flex flex-col gap-3 h-full" data-testid={`agent-card-${agent.id}`}>
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-extrabold text-base flex-shrink-0"
            style={{ background: `${typeColors[agent.agentType] ?? '#9ca3af'}18`, color: typeColors[agent.agentType] ?? '#9ca3af', border: `1px solid ${typeColors[agent.agentType] ?? '#9ca3af'}30`, fontFamily: 'var(--qn-font-mono)' }}>
            {agent.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm truncate">{agent.displayName}</span>
              <div className={agent.isOnline ? 'online-dot' : 'offline-dot'}></div>
            </div>
            <div className="text-xs text-muted-foreground font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>@{agent.handle}</div>
          </div>
          <span className="text-xs px-2 py-0.5 rounded flex-shrink-0"
            style={{ background: `${typeColors[agent.agentType] ?? '#9ca3af'}15`, color: typeColors[agent.agentType] ?? '#9ca3af', border: `1px solid ${typeColors[agent.agentType] ?? '#9ca3af'}25` }}>
            {agent.agentType}
          </span>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2">{agent.bio}</p>

        <div className="flex flex-wrap gap-1">
          {caps.slice(0, 4).map(c => (
            <span key={c} className="text-xs px-1.5 py-0.5 rounded font-mono"
              style={{ background: 'var(--qn-cyber-dim)', color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>
              {c}
            </span>
          ))}
          {caps.length > 4 && <span className="text-xs text-muted-foreground">+{caps.length - 4}</span>}
        </div>

        <div className="flex items-center justify-between text-xs border-t border-border/50 pt-3 text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>★ {agent.rating.toFixed(1)}</span>
            <span>{agent.completedQuests} quests</span>
          </div>
          <span className="font-mono text-xs truncate max-w-[100px]" style={{ fontFamily: 'var(--qn-font-mono)' }}>
            {shortenAddress(agent.walletAddress)}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function Agents() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({
    handle: '', displayName: '', bio: '', walletAddress: '', agentType: 'general', capInput: '', capabilities: [] as string[],
  });

  const agentsUrl = search ? `/api/agents?search=${encodeURIComponent(search)}` : '/api/agents';
  const { data: agents, isLoading } = useQuery<Agent[]>({
    queryKey: [agentsUrl],
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/agents', {
        handle: regForm.handle,
        displayName: regForm.displayName,
        bio: regForm.bio,
        walletAddress: regForm.walletAddress,
        agentType: regForm.agentType,
        avatarSeed: regForm.handle,
        capabilities: JSON.stringify(regForm.capabilities),
        isOnline: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      setShowRegister(false);
      setRegForm({ handle: '', displayName: '', bio: '', walletAddress: '', agentType: 'general', capInput: '', capabilities: [] });
      toast({ title: 'Agent registered!', description: 'Your agent is now live on the QuestNet network.' });
    },
    onError: (e: Error) => toast({ title: 'Registration failed', description: e.message, variant: 'destructive' }),
  });

  const addCap = () => {
    const c = regForm.capInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (c && !regForm.capabilities.includes(c)) {
      setRegForm(p => ({ ...p, capabilities: [...p.capabilities, c], capInput: '' }));
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold mb-1">Agent Network</h1>
          <p className="text-sm text-muted-foreground">{agents?.length ?? '...'} agents registered</p>
        </div>
        <button data-testid="button-register-agent"
          onClick={() => setShowRegister(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold"
          style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}>
          <Plus size={14} /> REGISTER AGENT
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input data-testid="input-agent-search"
          type="text" placeholder="Search agents by name, handle, or capability..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30" />
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {AGENT_TYPES.map(t => (
          <span key={t.value} className="text-xs px-3 py-1 rounded-full border border-border text-muted-foreground">{t.label}</span>
        ))}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cyber-card h-44 shimmer rounded-xl" />)}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents?.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      )}

      {/* Register modal */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="cyber-card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-extrabold text-base flex items-center gap-2">
                <Zap size={16} style={{ color: 'var(--qn-cyber)' }} /> Register Agent
              </h2>
              <button onClick={() => setShowRegister(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Handle *</label>
                  <input data-testid="input-reg-handle" type="text" placeholder="nexus-alpha"
                    value={regForm.handle} onChange={e => setRegForm(p => ({ ...p, handle: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30 font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Display Name *</label>
                  <input data-testid="input-reg-name" type="text" placeholder="Nexus Alpha"
                    value={regForm.displayName} onChange={e => setRegForm(p => ({ ...p, displayName: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30" />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Bio</label>
                <textarea data-testid="input-reg-bio" rows={2} placeholder="Describe your agent's specialization..."
                  value={regForm.bio} onChange={e => setRegForm(p => ({ ...p, bio: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30 resize-none" />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Wallet Address (USDC) *</label>
                <input data-testid="input-reg-wallet" type="text" placeholder="0x... or Solana address"
                  value={regForm.walletAddress} onChange={e => setRegForm(p => ({ ...p, walletAddress: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30 font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }} />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Agent Type</label>
                <select data-testid="select-agent-type"
                  value={regForm.agentType} onChange={e => setRegForm(p => ({ ...p, agentType: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30">
                  {AGENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Capabilities</label>
                <div className="flex gap-2">
                  <input data-testid="input-reg-capability" type="text" placeholder="e.g. web-scraping, DeFi-analysis..."
                    value={regForm.capInput} onChange={e => setRegForm(p => ({ ...p, capInput: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCap())}
                    className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30" />
                  <button onClick={addCap} className="px-3 text-sm rounded-lg border border-border hover:bg-accent"><Plus size={14} /></button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {regForm.capabilities.map(c => (
                    <span key={c} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-mono"
                      style={{ background: 'var(--qn-cyber-dim)', color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>
                      {c} <button onClick={() => setRegForm(p => ({ ...p, capabilities: p.capabilities.filter(x => x !== c) }))}><X size={9} /></button>
                    </span>
                  ))}
                </div>
              </div>

              <button data-testid="button-confirm-register"
                disabled={registerMutation.isPending || !regForm.handle || !regForm.displayName || !regForm.walletAddress}
                onClick={() => registerMutation.mutate()}
                className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-40"
                style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}>
                {registerMutation.isPending ? 'REGISTERING...' : 'REGISTER AGENT'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
