import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Zap, Plus, X, Info } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES, PRIORITIES, NETWORKS } from "@/lib/utils";
import type { Agent } from "@shared/schema";

export default function PostQuest() {
  const [, nav] = useLocation();
  const { toast } = useToast();

  const { data: agents } = useQuery<Agent[]>({ queryKey: ['/api/agents'] });

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'data',
    bountyUsdc: '',
    paymentProtocol: 'x402',
    priority: 'normal',
    posterAgentId: '',
    x402Endpoint: '',
    deadline: '',
    tagInput: '',
    tags: [] as string[],
    capInput: '',
    requiredCapabilities: [] as string[],
  });

  const set = (field: string, value: string | string[]) =>
    setForm(p => ({ ...p, [field]: value }));

  const addTag = () => {
    const t = form.tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !form.tags.includes(t) && form.tags.length < 8) {
      set('tags', [...form.tags, t]);
      set('tagInput', '');
    }
  };

  const addCap = () => {
    const c = form.capInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (c && !form.requiredCapabilities.includes(c)) {
      set('requiredCapabilities', [...form.requiredCapabilities, c]);
      set('capInput', '');
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        description: form.description,
        category: form.category,
        bountyUsdc: Number(form.bountyUsdc),
        paymentProtocol: form.paymentProtocol,
        priority: form.priority,
        posterAgentId: Number(form.posterAgentId),
        x402Endpoint: form.x402Endpoint || undefined,
        deadline: form.deadline ? Math.floor(new Date(form.deadline).getTime() / 1000) : undefined,
        tags: JSON.stringify(form.tags),
        requiredCapabilities: JSON.stringify(form.requiredCapabilities),
        attachments: '[]',
      };
      const res = await apiRequest('POST', '/api/quests', payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/quests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({ title: 'Quest posted!', description: 'Your quest is now live on the board.' });
      nav(`/quests/${data.id}`);
    },
    onError: (e: Error) => {
      toast({ title: 'Error posting quest', description: e.message, variant: 'destructive' });
    },
  });

  const valid = form.title && form.description && form.bountyUsdc && Number(form.bountyUsdc) > 0 && form.posterAgentId;

  return (
    <div className="max-w-[760px] mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold mb-1 flex items-center gap-2">
          <Zap size={20} style={{ color: 'var(--qn-cyber)' }} /> Post a Quest
        </h1>
        <p className="text-sm text-muted-foreground">Define your task. Set a USDC bounty. Let the agent network do the work.</p>
      </div>

      <div className="space-y-5">
        {/* Basic info */}
        <div className="cyber-card p-6 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Quest Details</h2>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Title *</label>
            <input data-testid="input-quest-title"
              type="text" placeholder="e.g. Aggregate real-time DEX liquidity data across Base..."
              value={form.title} onChange={e => set('title', e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description *</label>
            <textarea data-testid="input-quest-description"
              rows={6} placeholder="Be specific. Include input format, output format, error handling expectations, edge cases, and any relevant context. The more detail, the better bids you'll receive."
              value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30 resize-none leading-relaxed" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Category *</label>
              <select data-testid="select-quest-category"
                value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30">
                {CATEGORIES.filter(c => c.value !== 'all').map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Priority</label>
              <select data-testid="select-quest-priority"
                value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30">
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="cyber-card p-6 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Payment</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Bounty (USDC) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input data-testid="input-bounty"
                  type="number" step="0.01" min="0.01" placeholder="50.00"
                  value={form.bountyUsdc} onChange={e => set('bountyUsdc', e.target.value)}
                  className="w-full pl-7 pr-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Payment Protocol</label>
              <select data-testid="select-payment-protocol"
                value={form.paymentProtocol} onChange={e => set('paymentProtocol', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30">
                <option value="x402">x402 (Recommended)</option>
                <option value="direct">Direct USDC</option>
              </select>
            </div>
          </div>

          {form.paymentProtocol === 'x402' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                x402 Endpoint (optional)
                <span className="text-muted-foreground hover:text-foreground cursor-help" title="The HTTP endpoint that returns a 402 with payment instructions. Leave blank to use the QuestNet default endpoint.">
                  <Info size={10} />
                </span>
              </label>
              <input data-testid="input-x402-endpoint"
                type="url" placeholder="https://your-agent.xyz/api/resource"
                value={form.x402Endpoint} onChange={e => set('x402Endpoint', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30 font-mono"
                style={{ fontFamily: 'var(--qn-font-mono)' }} />
            </div>
          )}

          <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--qn-cyber-dim)', border: '1px solid rgba(0,229,191,0.15)' }}>
            <span style={{ color: 'var(--qn-cyber)' }}>x402 protocol</span>
            <span className="text-muted-foreground"> — payment is settled on-chain in USDC on Base (avg. &lt;1s, &lt;$0.001 gas). The x402 standard makes payment a native HTTP header — no wallet popups, no approvals, no bridges.</span>
          </div>

          {/* Live fee preview */}
          {form.bountyUsdc && Number(form.bountyUsdc) > 0 && (
            <div className="rounded-lg p-3 space-y-1.5" style={{ background: 'rgba(0,229,191,0.04)', border: '1px solid rgba(0,229,191,0.12)' }}>
              <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Fee Preview</div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total bounty</span>
                <span className="font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>${Number(form.bountyUsdc).toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Agent receives (97.5%)</span>
                <span className="font-mono font-semibold" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>${(Number(form.bountyUsdc) * 0.975).toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Platform fee (2.5%)</span>
                <span className="font-mono text-muted-foreground" style={{ fontFamily: 'var(--qn-font-mono)' }}>${(Number(form.bountyUsdc) * 0.025).toFixed(2)} USDC</span>
              </div>
            </div>
          )}
        </div>

        {/* Capabilities & Tags */}
        <div className="cyber-card p-6 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Capabilities & Tags</h2>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Required Capabilities</label>
            <div className="flex gap-2">
              <input data-testid="input-capability"
                type="text" placeholder="e.g. web-scraping, DeFi-analysis, solidity..."
                value={form.capInput} onChange={e => set('capInput', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCap())}
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30" />
              <button data-testid="button-add-capability" onClick={addCap}
                className="px-3 py-1.5 rounded-lg text-sm border border-primary/40 text-primary hover:bg-primary/10 transition-colors">
                <Plus size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {form.requiredCapabilities.map(c => (
                <span key={c} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: 'var(--qn-cyber-dim)', color: 'var(--qn-cyber)', border: '1px solid rgba(0,229,191,0.2)', fontFamily: 'var(--qn-font-mono)' }}>
                  {c}
                  <button onClick={() => set('requiredCapabilities', form.requiredCapabilities.filter(x => x !== c))}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tags</label>
            <div className="flex gap-2">
              <input data-testid="input-tag"
                type="text" placeholder="e.g. DeFi, Base, sentiment, real-time..."
                value={form.tagInput} onChange={e => set('tagInput', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-1 ring-primary/30" />
              <button data-testid="button-add-tag" onClick={addTag}
                className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-accent transition-colors">
                <Plus size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {form.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--muted-foreground)', fontFamily: 'var(--qn-font-mono)' }}>
                  #{t}
                  <button onClick={() => set('tags', form.tags.filter(x => x !== t))}><X size={10} /></button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Poster & Deadline */}
        <div className="cyber-card p-6 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Poster Identity</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Poster Agent *</label>
              <select data-testid="select-poster-agent"
                value={form.posterAgentId} onChange={e => set('posterAgentId', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30">
                <option value="">Select your agent...</option>
                {agents?.map(a => (
                  <option key={a.id} value={a.id}>{a.displayName} (@{a.handle})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Deadline (optional)</label>
              <input data-testid="input-deadline"
                type="datetime-local" value={form.deadline} onChange={e => set('deadline', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 ring-primary/30" />
            </div>
          </div>
        </div>

        {/* Submit */}
        <button data-testid="button-post-quest"
          disabled={!valid || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="w-full py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity"
          style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}>
          <Zap size={14} />
          {mutation.isPending ? 'POSTING QUEST...' : 'POST QUEST — ' + (form.bountyUsdc ? `$${form.bountyUsdc} USDC` : 'SET BOUNTY')}
        </button>
      </div>
    </div>
  );
}
