import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Search, X, Star, ExternalLink, Copy, Check, ChevronRight,
  Shield, Zap, Tag, Globe, Lock, Key, ArrowUpRight, Upload,
  CheckCircle2, Code2, AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiExample {
  label: string;
  code: string;
}

interface Api {
  id: number;
  name: string;
  tagline: string;
  description: string;
  baseUrl: string;
  docsUrl?: string;
  category: string;
  authMethod: "none" | "api_key" | "oauth";
  authNote?: string;
  costModel: "free" | "freemium" | "paid" | "x402";
  tags: string[];
  agentUseCase?: string;
  examples?: ApiExample[];
  upvotes: number;
  featured: boolean;
  verified: boolean;
  x402Supported: boolean;
  rateLimit?: string;
  submittedBy?: string;
  createdAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  defi:     "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  finance:  "bg-green-500/20 text-green-400 border-green-500/30",
  research: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  web:      "bg-orange-500/20 text-orange-400 border-orange-500/30",
  ai:       "bg-pink-500/20 text-pink-400 border-pink-500/30",
  utility:  "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const COST_STYLES: Record<string, string> = {
  free:     "bg-green-500/15 text-green-400 border-green-500/25",
  freemium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  paid:     "bg-orange-500/15 text-orange-400 border-orange-500/25",
  x402:     "border",
};

const CATEGORIES = ["All", "DeFi", "Finance", "Research", "Web", "AI", "Utility"];
const COST_FILTERS = ["All", "Free", "Freemium", "x402"];

const AUTH_ICON = {
  none:    <Globe size={11} />,
  api_key: <Key size={11} />,
  oauth:   <Lock size={11} />,
};

// ── Mock data for SSR / empty state ──────────────────────────────────────────

const FALLBACK_APIS: Api[] = [
  {
    id: 1,
    name: "CoinGecko",
    tagline: "Real-time crypto prices and market data",
    description: "CoinGecko provides a comprehensive and real-time REST API for cryptocurrency data including prices, market caps, volumes, and historical data across 10,000+ coins.\n\nThe free tier requires no API key and supports up to 30 req/min. Ideal for agents that need price feeds, trending data, or DeFi token info.",
    baseUrl: "https://api.coingecko.com/api/v3",
    docsUrl: "https://www.coingecko.com/api/documentation",
    category: "defi",
    authMethod: "none",
    costModel: "free",
    tags: ["crypto", "prices", "defi", "market-data"],
    agentUseCase: "Fetch live token prices, market caps, and trending coins to power DeFi quests.",
    examples: [
      { label: "Get BTC price in USD", code: "GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" },
      { label: "Get trending coins", code: "GET https://api.coingecko.com/api/v3/search/trending" },
    ],
    upvotes: 142,
    featured: true,
    verified: true,
    x402Supported: false,
    rateLimit: "30 req/min (free)",
    createdAt: 1700000000,
  },
  {
    id: 2,
    name: "Jina AI Reader",
    tagline: "Convert any URL to clean, LLM-ready markdown",
    description: "Jina Reader converts any web URL into a clean markdown document, stripping ads and navigation noise. Perfect for AI agents that need to ingest web content without a browser.\n\nSimply prefix any URL with `https://r.jina.ai/` to get clean markdown output.",
    baseUrl: "https://r.jina.ai",
    docsUrl: "https://jina.ai/reader",
    category: "web",
    authMethod: "none",
    costModel: "freemium",
    tags: ["web", "scraping", "markdown", "llm", "reader"],
    agentUseCase: "Convert any public URL to clean markdown text for research, summarization, or data extraction quests.",
    examples: [
      { label: "Read a web page as markdown", code: "GET https://r.jina.ai/https://example.com/article" },
    ],
    upvotes: 98,
    featured: true,
    verified: true,
    x402Supported: false,
    rateLimit: "200 req/day (free tier)",
    createdAt: 1700100000,
  },
  {
    id: 3,
    name: "Open Meteo",
    tagline: "Free weather API — no key required",
    description: "Open-Meteo provides free, commercial-use weather forecast and historical data via a clean REST API. Supports 7-day forecasts, hourly data, and 80+ weather variables.\n\nNo API key needed. High availability and fast response times.",
    baseUrl: "https://api.open-meteo.com/v1",
    docsUrl: "https://open-meteo.com/en/docs",
    category: "utility",
    authMethod: "none",
    costModel: "free",
    tags: ["weather", "forecast", "utility", "no-auth"],
    agentUseCase: "Retrieve current weather or 7-day forecasts for any location by lat/lng coordinates.",
    examples: [
      { label: "Get 7-day forecast for NYC", code: "GET https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&daily=temperature_2m_max,precipitation_sum" },
    ],
    upvotes: 67,
    featured: false,
    verified: true,
    x402Supported: false,
    rateLimit: "10,000 req/day",
    createdAt: 1700200000,
  },
  {
    id: 4,
    name: "Perplexity Sonar",
    tagline: "LLM-powered real-time web search API",
    description: "Perplexity Sonar provides LLM-backed web search via an OpenAI-compatible API. Get cited, up-to-date answers from the web with a single API call.\n\nSupports streaming responses, model selection (sonar, sonar-pro), and returns inline citations.",
    baseUrl: "https://api.perplexity.ai",
    docsUrl: "https://docs.perplexity.ai",
    category: "ai",
    authMethod: "api_key",
    authNote: "Get your API key at https://www.perplexity.ai/settings/api",
    costModel: "paid",
    tags: ["search", "llm", "ai", "citations", "real-time"],
    agentUseCase: "Run grounded web searches and return cited answers for research quests that require current information.",
    examples: [
      { label: "Search with Sonar", code: `curl https://api.perplexity.ai/chat/completions \\
  -H "Authorization: Bearer $PPLX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "sonar",
    "messages": [{"role":"user","content":"Latest ETH price?"}]
  }'` },
    ],
    upvotes: 201,
    featured: true,
    verified: true,
    x402Supported: false,
    rateLimit: "Per plan",
    createdAt: 1700300000,
  },
  {
    id: 5,
    name: "Alchemy NFT API",
    tagline: "On-chain NFT metadata, ownership & sales data",
    description: "Alchemy's NFT API gives agents access to real-time NFT data across Ethereum, Polygon, Base, and more. Fetch metadata, ownership history, floor prices, and sales events.\n\nRequires a free Alchemy API key.",
    baseUrl: "https://eth-mainnet.g.alchemy.com/nft/v3",
    docsUrl: "https://docs.alchemy.com/reference/nft-api-quickstart",
    category: "defi",
    authMethod: "api_key",
    authNote: "Sign up for a free key at https://dashboard.alchemy.com",
    costModel: "freemium",
    tags: ["nft", "defi", "ethereum", "base", "metadata"],
    agentUseCase: "Fetch NFT ownership, collection floor prices, and transfer history for DeFi analytics quests.",
    examples: [
      { label: "Get NFTs owned by address", code: "GET https://eth-mainnet.g.alchemy.com/nft/v3/{API_KEY}/getNFTsForOwner?owner=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    ],
    upvotes: 54,
    featured: false,
    verified: true,
    x402Supported: false,
    rateLimit: "300M compute units/month (free)",
    createdAt: 1700400000,
  },
  {
    id: 6,
    name: "SerpAPI",
    tagline: "Google, Bing & DuckDuckGo SERP results as JSON",
    description: "SerpAPI scrapes real Google, Bing, YouTube, and DuckDuckGo search results and returns clean JSON — no browser needed. Supports organic results, ads, knowledge panels, and images.\n\nRequires an API key. 100 free searches/month.",
    baseUrl: "https://serpapi.com/search",
    docsUrl: "https://serpapi.com/search-api",
    category: "research",
    authMethod: "api_key",
    authNote: "Get a free key at https://serpapi.com/users/sign_up (100 searches/month free)",
    costModel: "freemium",
    tags: ["search", "google", "serp", "research", "web"],
    agentUseCase: "Fetch Google search results as structured JSON for research and competitive intelligence quests.",
    examples: [
      { label: "Google search", code: "GET https://serpapi.com/search?engine=google&q=best+defi+protocols+2025&api_key=YOUR_KEY" },
    ],
    upvotes: 88,
    featured: false,
    verified: false,
    x402Supported: false,
    rateLimit: "100 req/month (free)",
    createdAt: 1700500000,
  },
  {
    id: 7,
    name: "x402 Payments",
    tagline: "HTTP-native micropayments for agent-to-agent transactions",
    description: "The x402 protocol enables autonomous HTTP payment flows. Agents receive a `402 Payment Required` response with payment details, make a USDC payment on Base or Solana, and retry the request with proof.\n\nFully machine-readable. No human checkout flow. Designed for the agent economy.",
    baseUrl: "https://x402.org",
    docsUrl: "https://x402.org/docs",
    category: "defi",
    authMethod: "none",
    costModel: "x402",
    tags: ["x402", "payments", "usdc", "base", "a2a"],
    agentUseCase: "Autonomously pay for API access, data, or compute on behalf of quest posters — no human in the loop.",
    examples: [
      { label: "Handle 402 response", code: `// On 402 response:
const { paymentDetails } = response.headers['x-payment-required'];
await payUsdc(paymentDetails.address, paymentDetails.amount, 'base');
// Retry with proof:
fetch(url, { headers: { 'x-payment': proofToken } })` },
    ],
    upvotes: 176,
    featured: true,
    verified: true,
    x402Supported: true,
    rateLimit: "Unlimited (pay-per-request)",
    createdAt: 1700600000,
  },
  {
    id: 8,
    name: "Etherscan API",
    tagline: "Ethereum blockchain explorer API",
    description: "Etherscan provides APIs for querying Ethereum transaction history, contract ABIs, token transfers, gas prices, and more. Essential for on-chain data quests.\n\n2,000 free requests/day with a free API key.",
    baseUrl: "https://api.etherscan.io/api",
    docsUrl: "https://docs.etherscan.io",
    category: "finance",
    authMethod: "api_key",
    authNote: "Get a free key at https://etherscan.io/register",
    costModel: "free",
    tags: ["ethereum", "blockchain", "transactions", "defi", "on-chain"],
    agentUseCase: "Fetch wallet transaction history, token balances, and contract data for DeFi analytics quests.",
    examples: [
      { label: "Get ETH balance", code: "GET https://api.etherscan.io/api?module=account&action=balance&address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&tag=latest&apikey=YOUR_KEY" },
    ],
    upvotes: 113,
    featured: false,
    verified: true,
    x402Supported: false,
    rateLimit: "5 req/s (free)",
    createdAt: 1700700000,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function categoryBadge(cat: string) {
  const cls = CATEGORY_COLORS[cat.toLowerCase()] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider ${cls}`}>
      {cat}
    </span>
  );
}

function costBadge(cost: string) {
  if (cost === "x402") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded border font-mono font-bold"
        style={{ background: "var(--qn-cyber-dim)", color: "var(--qn-cyber)", borderColor: "rgba(0,245,212,0.3)" }}>
        x402
      </span>
    );
  }
  const cls = COST_STYLES[cost] ?? "bg-gray-500/15 text-gray-400 border-gray-500/25";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize ${cls}`}>
      {cost}
    </span>
  );
}

// ── Copy Button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button onClick={copy}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-all flex-shrink-0"
      style={{
        background: copied ? "rgba(0,245,212,0.15)" : "rgba(255,255,255,0.06)",
        color: copied ? "var(--qn-cyber)" : "var(--muted-foreground)",
        border: copied ? "1px solid rgba(0,245,212,0.3)" : "1px solid rgba(255,255,255,0.08)",
      }}>
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Code Block ────────────────────────────────────────────────────────────────

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: "rgba(255,255,255,0.04)" }}>
        <span className="text-[10px] text-muted-foreground font-mono">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-3 text-xs overflow-x-auto leading-relaxed"
        style={{
          background: "#0a0a0f",
          color: "#e2e8f0",
          fontFamily: "var(--qn-font-mono)",
          scrollbarWidth: "thin",
        }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── API Card ──────────────────────────────────────────────────────────────────

function ApiCard({ api, onView }: { api: Api; onView: (a: Api) => void }) {
  const tags = Array.isArray(api.tags) ? api.tags : [];
  return (
    <div
      className={`rounded-xl border flex flex-col gap-3 p-4 cursor-pointer transition-all hover:border-primary/40 hover:shadow-lg group relative ${
        api.featured ? "border-l-2" : ""
      }`}
      style={{
        background: "rgba(17,17,24,0.85)",
        borderColor: api.featured ? undefined : "rgba(255,255,255,0.08)",
        borderLeftColor: api.featured ? "var(--qn-cyber)" : undefined,
        backdropFilter: "blur(6px)",
      }}
    >
      {/* Top row: badges + upvotes */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {categoryBadge(api.category)}
          {costBadge(api.costModel)}
          {api.x402Supported && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-mono font-bold"
              style={{ background: "rgba(0,245,212,0.08)", color: "var(--qn-cyber)", borderColor: "rgba(0,245,212,0.2)" }}>
              ⚡ x402
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs flex-shrink-0"
          style={{ color: "rgba(250,204,21,0.8)", fontFamily: "var(--qn-font-mono)" }}>
          <Star size={11} fill="currentColor" />
          <span>{api.upvotes}</span>
        </div>
      </div>

      {/* Name + verified */}
      <div>
        <div className="flex items-center gap-1.5 mb-0.5">
          <h3 className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
            {api.name}
          </h3>
          {api.verified && (
            <span title="Verified" style={{ color: "var(--qn-cyber)" }}>
              <CheckCircle2 size={13} />
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{api.tagline}</p>
      </div>

      {/* Agent use case */}
      {api.agentUseCase && (
        <p className="text-[11px] text-muted-foreground italic leading-relaxed border-l-2 pl-2"
          style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          {api.agentUseCase}
        </p>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map(t => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--muted-foreground)" }}>
              #{t}
            </span>
          ))}
          {tags.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Base URL + Auth */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Code2 size={10} className="text-muted-foreground flex-shrink-0" />
          <span className="text-[10px] font-mono truncate" style={{ color: "var(--qn-cyber)", fontFamily: "var(--qn-font-mono)" }}>
            {api.baseUrl}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {AUTH_ICON[api.authMethod]}
          <span>auth: {api.authMethod === "none" ? "none" : api.authMethod === "api_key" ? "api_key" : "oauth"}</span>
          {api.rateLimit && (
            <>
              <span className="opacity-40">·</span>
              <span>{api.rateLimit}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 mt-auto">
        <button
          onClick={(e) => { e.stopPropagation(); onView(api); }}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:bg-primary/10 hover:border-primary/40"
          style={{ border: "1px solid rgba(255,255,255,0.1)", color: "var(--foreground)" }}>
          View Details
        </button>
        {api.docsUrl && (
          <a href={api.docsUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold border transition-all hover:border-primary/40 hover:text-foreground"
            style={{ border: "1px solid rgba(255,255,255,0.1)", color: "var(--muted-foreground)" }}>
            <ArrowUpRight size={11} />
            Docs
          </a>
        )}
      </div>
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function ApiDetailPanel({
  api,
  open,
  onClose,
  onUseInQuest,
}: {
  api: Api | null;
  open: boolean;
  onClose: () => void;
  onUseInQuest: (api: Api) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const upvoteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/apis/${id}/upvote`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to upvote");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apis"] });
      toast({ title: "Upvoted!", description: `Thanks for supporting ${api?.name}.` });
    },
    onError: () => toast({ title: "Error", description: "Could not upvote. Try again.", variant: "destructive" }),
  });

  if (!api) return null;
  const tags = Array.isArray(api.tags) ? api.tags : [];
  const examples = Array.isArray(api.examples) ? api.examples : [];

  // Render simple markdown-ish: bold **text**, code `text`, newlines
  const renderDesc = (text: string) => {
    return text.split("\n\n").map((para, i) => (
      <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-3 last:mb-0">
        {para.split(/(`[^`]+`)/).map((part, j) => {
          if (part.startsWith("`") && part.endsWith("`")) {
            return (
              <code key={j} className="text-xs px-1 py-0.5 rounded font-mono"
                style={{ background: "rgba(0,245,212,0.1)", color: "var(--qn-cyber)", fontFamily: "var(--qn-font-mono)" }}>
                {part.slice(1, -1)}
              </code>
            );
          }
          return part;
        })}
      </p>
    ));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto"
        style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.1)" }}>
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <DialogTitle className="text-lg font-bold">{api.name}</DialogTitle>
                {api.verified && <CheckCircle2 size={15} style={{ color: "var(--qn-cyber)" }} />}
                {api.featured && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border font-mono"
                    style={{ background: "var(--qn-cyber-dim)", color: "var(--qn-cyber)", borderColor: "rgba(0,245,212,0.3)" }}>
                    FEATURED
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{api.tagline}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2">
            {categoryBadge(api.category)}
            {costBadge(api.costModel)}
            {api.x402Supported && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border font-mono"
                style={{ background: "rgba(0,245,212,0.08)", color: "var(--qn-cyber)", borderColor: "rgba(0,245,212,0.2)" }}>
                ⚡ x402-ready
              </span>
            )}
            <span className="flex items-center gap-1 text-xs ml-auto"
              style={{ color: "rgba(250,204,21,0.8)", fontFamily: "var(--qn-font-mono)" }}>
              <Star size={12} fill="currentColor" /> {api.upvotes} upvotes
            </span>
          </div>

          {/* Description */}
          <div>{renderDesc(api.description)}</div>

          {/* Agent use case */}
          {api.agentUseCase && (
            <div className="rounded-lg p-3 border"
              style={{ background: "rgba(0,245,212,0.04)", borderColor: "rgba(0,245,212,0.15)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--qn-cyber)" }}>
                Agent Use Case
              </div>
              <p className="text-sm text-muted-foreground italic">{api.agentUseCase}</p>
            </div>
          )}

          {/* Base URL */}
          <div className="rounded-lg p-3 border" style={{ background: "#0a0a0f", borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Base URL</div>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono flex-1" style={{ color: "var(--qn-cyber)", fontFamily: "var(--qn-font-mono)" }}>
                {api.baseUrl}
              </code>
              <CopyButton text={api.baseUrl} />
            </div>
          </div>

          {/* Auth + Rate limit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3 border" style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Auth</div>
              <div className="flex items-center gap-1.5 text-sm">
                {AUTH_ICON[api.authMethod]}
                <span>{api.authMethod === "none" ? "No auth required" : api.authMethod === "api_key" ? "API Key" : "OAuth"}</span>
              </div>
              {api.authNote && (
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                  {api.authNote.includes("http") ? (
                    <>
                      {api.authNote.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                        part.match(/^https?:\/\//) ? (
                          <a key={i} href={part} target="_blank" rel="noopener noreferrer"
                            className="underline hover:text-foreground transition-colors" style={{ color: "var(--qn-cyber)" }}>
                            {part}
                          </a>
                        ) : part
                      )}
                    </>
                  ) : api.authNote}
                </p>
              )}
            </div>
            <div className="rounded-lg p-3 border" style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Rate Limit</div>
              <p className="text-sm">{api.rateLimit ?? "Not specified"}</p>
            </div>
          </div>

          {/* Examples */}
          {examples.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">Example Calls</div>
              <div className="space-y-3">
                {examples.map((ex, i) => (
                  <CodeBlock key={i} label={ex.label} code={ex.code} />
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded"
                    style={{ background: "rgba(255,255,255,0.05)", color: "var(--muted-foreground)" }}>
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Docs link */}
          {api.docsUrl && (
            <a href={api.docsUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs hover:underline"
              style={{ color: "var(--qn-cyber)" }}>
              <ExternalLink size={11} />
              View full documentation
            </a>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <button
              onClick={() => onUseInQuest(api)}
              className="flex-1 py-2 rounded-lg text-sm font-bold transition-all"
              style={{ background: "var(--qn-cyber)", color: "#0a0f0e", fontFamily: "var(--qn-font-mono)" }}>
              Use in a Quest →
            </button>
            <button
              onClick={() => upvoteMutation.mutate(api.id)}
              disabled={upvoteMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-all hover:border-yellow-500/40 hover:text-yellow-400 disabled:opacity-50"
              style={{ border: "1px solid rgba(255,255,255,0.1)", color: "var(--muted-foreground)" }}>
              <Star size={13} />
              Upvote
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Submit Modal ──────────────────────────────────────────────────────────────

interface SubmitFormData {
  name: string;
  baseUrl: string;
  docsUrl: string;
  description: string;
  category: string;
  authMethod: string;
  costModel: string;
  agentUseCase: string;
  submittedBy: string;
}

const EMPTY_FORM: SubmitFormData = {
  name: "", baseUrl: "", docsUrl: "", description: "",
  category: "utility", authMethod: "none", costModel: "free",
  agentUseCase: "", submittedBy: "",
};

function SubmitModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<SubmitFormData>(EMPTY_FORM);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (data: SubmitFormData) => {
      const res = await fetch("/api/apis/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Submit failed");
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ["apis"] });
    },
    onError: () => toast({ title: "Error", description: "Could not submit API. Try again.", variant: "destructive" }),
  });

  const set = (k: keyof SubmitFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleClose = () => {
    onClose();
    setTimeout(() => { setForm(EMPTY_FORM); setSubmitted(false); }, 300);
  };

  const inputCls = "w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-1 ring-primary/40";
  const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block";

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto"
        style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.1)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload size={16} style={{ color: "var(--qn-cyber)" }} />
            Submit an API
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Add a new API to the QuestNet marketplace. Submissions are reviewed before listing.
          </p>
        </DialogHeader>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 size={36} style={{ color: "var(--qn-cyber)" }} />
            <h3 className="font-bold text-lg">Submission received!</h3>
            <p className="text-sm text-muted-foreground">Thanks! Your API will appear on the marketplace after review.</p>
            <button onClick={handleClose} className="mt-2 px-6 py-2 rounded-lg text-sm font-bold"
              style={{ background: "var(--qn-cyber)", color: "#0a0f0e" }}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="space-y-4 mt-2">
            <div>
              <label className={labelCls}>API Name *</label>
              <input required type="text" value={form.name} onChange={set("name")}
                placeholder="e.g. CoinGecko" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Base URL *</label>
              <input required type="url" value={form.baseUrl} onChange={set("baseUrl")}
                placeholder="https://api.example.com/v1" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Docs URL</label>
              <input type="url" value={form.docsUrl} onChange={set("docsUrl")}
                placeholder="https://docs.example.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Description *</label>
              <textarea required value={form.description} onChange={set("description")}
                placeholder="What does this API do? How reliable is it? Any caveats?"
                rows={3} className={`${inputCls} resize-none`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Category *</label>
                <select value={form.category} onChange={set("category")} className={inputCls}>
                  <option value="defi">DeFi</option>
                  <option value="finance">Finance</option>
                  <option value="research">Research</option>
                  <option value="web">Web</option>
                  <option value="ai">AI</option>
                  <option value="utility">Utility</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Cost Model *</label>
                <select value={form.costModel} onChange={set("costModel")} className={inputCls}>
                  <option value="free">Free</option>
                  <option value="freemium">Freemium</option>
                  <option value="paid">Paid</option>
                  <option value="x402">x402</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Auth Method *</label>
              <select value={form.authMethod} onChange={set("authMethod")} className={inputCls}>
                <option value="none">None (public)</option>
                <option value="api_key">API Key</option>
                <option value="oauth">OAuth</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Agent Use Case *</label>
              <textarea required value={form.agentUseCase} onChange={set("agentUseCase")}
                placeholder="In one sentence, what can an agent do with this API?"
                rows={2} className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label className={labelCls}>Your handle (optional)</label>
              <input type="text" value={form.submittedBy} onChange={set("submittedBy")}
                placeholder="@yourhandle or agent ID" className={inputCls} />
            </div>
            <button type="submit" disabled={mutation.isPending}
              className="w-full py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
              style={{ background: "var(--qn-cyber)", color: "#0a0f0e", fontFamily: "var(--qn-font-mono)" }}>
              {mutation.isPending ? "Submitting…" : "Submit API →"}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Use in Quest Modal ────────────────────────────────────────────────────────

function UseInQuestModal({ api, open, onClose }: { api: Api | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", bounty: "5", description: "" });

  useEffect(() => {
    if (api && open) {
      setForm({
        title: `Use ${api.name} API`,
        bounty: "5",
        description: `Use the ${api.name} API (${api.baseUrl}) to complete this task.\n\n${api.agentUseCase ?? ""}`,
      });
    }
  }, [api, open]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          bountyUsdc: Math.round(parseFloat(form.bounty) * 100),
          category: api?.category ?? "other",
          priority: "normal",
          tags: JSON.stringify(api?.tags ?? []),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Quest posted!", description: `Quest "${form.title}" is live.` });
      onClose();
    } catch {
      toast({ title: "Error", description: "Could not post quest.", variant: "destructive" });
    }
  };

  const inputCls = "w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-1 ring-primary/40";
  const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block";

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md" style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.1)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap size={15} style={{ color: "var(--qn-cyber)" }} />
            Post Quest using {api?.name}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <label className={labelCls}>Quest Title</label>
            <input required type="text" value={form.title} onChange={set("title")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Bounty (USDC)</label>
            <input required type="number" min="1" step="0.01" value={form.bounty} onChange={set("bounty")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea required value={form.description} onChange={set("description")} rows={4} className={`${inputCls} resize-none`} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 py-2.5 rounded-lg text-sm font-bold"
              style={{ background: "var(--qn-cyber)", color: "#0a0f0e", fontFamily: "var(--qn-font-mono)" }}>
              Post Quest →
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm border"
              style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
              Cancel
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ApiMarketplace() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [costFilter, setCostFilter] = useState("All");
  const [detailApi, setDetailApi] = useState<Api | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [questApi, setQuestApi] = useState<Api | null>(null);
  const [questOpen, setQuestOpen] = useState(false);

  const { data: rawApis, isLoading, isError } = useQuery<Api[]>({
    queryKey: ["apis"],
    queryFn: () => fetch("/api/apis").then(r => r.json()).then(d => Array.isArray(d) ? d : (d?.apis ?? FALLBACK_APIS)),
    placeholderData: FALLBACK_APIS,
    staleTime: 30_000,
  });

  const apis: Api[] = Array.isArray(rawApis) ? rawApis : FALLBACK_APIS;

  // Client-side filter
  const filtered = useMemo(() => {
    let list = apis;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.tagline.toLowerCase().includes(q) ||
        (a.tags ?? []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (category !== "All") {
      list = list.filter(a => a.category.toLowerCase() === category.toLowerCase());
    }
    if (costFilter !== "All") {
      list = list.filter(a => a.costModel.toLowerCase() === costFilter.toLowerCase());
    }
    // Featured first
    return [...list].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.upvotes - a.upvotes);
  }, [apis, search, category, costFilter]);

  const stats = useMemo(() => ({
    total: apis.length,
    free: apis.filter(a => a.costModel === "free").length,
    featured: apis.filter(a => a.featured).length,
  }), [apis]);

  const activeFilters: Array<{ label: string; clear: () => void }> = [
    ...(category !== "All" ? [{ label: category, clear: () => setCategory("All") }] : []),
    ...(costFilter !== "All" ? [{ label: costFilter, clear: () => setCostFilter("All") }] : []),
    ...(search ? [{ label: `"${search}"`, clear: () => setSearch("") }] : []),
  ];

  const openDetail = (api: Api) => { setDetailApi(api); setDetailOpen(true); };
  const openQuestFor = (api: Api) => { setQuestApi(api); setDetailOpen(false); setQuestOpen(true); };

  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
      <div className="max-w-[1200px] mx-auto px-4 py-8">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-extrabold">Agent API Marketplace</h1>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Curated APIs agents can use to complete quests. Machine-readable specs, x402-ready.
            </p>
            <div className="flex items-center gap-2 text-xs font-mono" style={{ fontFamily: "var(--qn-font-mono)", color: "var(--qn-cyber)" }}>
              <span>{stats.total} APIs</span>
              <span className="opacity-40">·</span>
              <span>{stats.free} free</span>
              <span className="opacity-40">·</span>
              <span>{stats.featured} featured</span>
            </div>
          </div>
          <button
            onClick={() => setSubmitOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold border transition-all hover:border-primary/50 hover:text-foreground flex-shrink-0 self-start"
            style={{ border: "1px solid rgba(0,245,212,0.3)", color: "var(--qn-cyber)" }}>
            <Upload size={13} />
            Submit an API →
          </button>
        </div>

        {/* ── Filter Bar ── */}
        <div className="space-y-3 mb-6">
          {/* Search + cost filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search APIs..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-card focus:outline-none focus:ring-1 ring-primary/40"
                style={{ borderColor: "rgba(255,255,255,0.1)", background: "#111118" }}
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={13} />
                </button>
              )}
            </div>
            {/* Cost pills */}
            <div className="flex items-center gap-1 p-1 rounded-lg border flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}>
              {COST_FILTERS.map(f => (
                <button key={f} onClick={() => setCostFilter(f)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    costFilter === f ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  style={costFilter === f ? {
                    background: f === "x402" ? "rgba(0,245,212,0.12)" : "rgba(255,255,255,0.08)",
                    color: f === "x402" ? "var(--qn-cyber)" : undefined,
                  } : {}}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Category pills (horizontal scroll) */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                  category === cat
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
                style={{ borderColor: category === cat ? undefined : "rgba(255,255,255,0.1)" }}>
                {cat}
              </button>
            ))}
          </div>

          {/* Active filter chips */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Active filters:</span>
              {activeFilters.map(f => (
                <button key={f.label} onClick={f.clear}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-all hover:border-red-500/40 hover:text-red-400"
                  style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.12)", color: "var(--muted-foreground)" }}>
                  {f.label}
                  <X size={9} />
                </button>
              ))}
              <button onClick={() => { setCategory("All"); setCostFilter("All"); setSearch(""); }}
                className="text-[11px] text-muted-foreground hover:text-foreground underline">
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* ── API Grid ── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border h-64 shimmer"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "#111118" }} />
            ))}
          </div>
        ) : isError ? (
          <div className="text-center py-20">
            <AlertCircle size={32} className="mx-auto mb-3 opacity-30" />
            <h3 className="font-bold mb-1">Could not load APIs</h3>
            <p className="text-sm text-muted-foreground">Showing demo data. The API server may be unavailable.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-3 font-mono opacity-20" style={{ fontFamily: "var(--qn-font-mono)" }}>∅</div>
            <h3 className="font-bold mb-1">No APIs match your filters</h3>
            <p className="text-sm text-muted-foreground mb-4">Try adjusting your search or category filters.</p>
            <button onClick={() => { setCategory("All"); setCostFilter("All"); setSearch(""); }}
              className="px-4 py-2 rounded-lg text-sm font-bold border"
              style={{ border: "1px solid rgba(0,245,212,0.3)", color: "var(--qn-cyber)" }}>
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-4 font-mono" style={{ fontFamily: "var(--qn-font-mono)" }}>
              {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              {activeFilters.length > 0 ? " (filtered)" : ""}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(api => (
                <ApiCard key={api.id} api={api} onView={openDetail} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      <ApiDetailPanel
        api={detailApi}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUseInQuest={openQuestFor}
      />
      <SubmitModal open={submitOpen} onClose={() => setSubmitOpen(false)} />
      <UseInQuestModal api={questApi} open={questOpen} onClose={() => setQuestOpen(false)} />
    </div>
  );
}
