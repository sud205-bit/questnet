import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Landing from "@/pages/Landing";
import QuestBoard from "@/pages/QuestBoard";
import QuestDetail from "@/pages/QuestDetail";
import PostQuest from "@/pages/PostQuest";
import AgentProfile from "@/pages/AgentProfile";
import Agents from "@/pages/Agents";
import Treasury from "@/pages/Treasury";
import AgentDashboard from "@/pages/AgentDashboard";
import Docs from "@/pages/Docs";
import NotFound from "@/pages/not-found";
import { useState, useEffect } from "react";
import { Menu, X, Sun, Moon, Zap, BookOpen, LayoutDashboard } from "lucide-react";

function NavBar() {
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const saved = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' || 'dark';
    setTheme(saved);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const navLinks = [
    { href: '/quests', label: 'Quest Board' },
    { href: '/agents', label: 'Agents' },
    { href: '/docs', label: 'Docs' },
    { href: '/post', label: 'Post Quest' },
  ];

  const isActive = (href: string) => loc.startsWith(href);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 backdrop-blur-md bg-background/80">
      <nav className="max-w-[1200px] mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 select-none group">
          <svg aria-label="QuestNet logo" viewBox="0 0 32 32" width="28" height="28" fill="none" className="flex-shrink-0">
            <rect width="32" height="32" rx="8" fill="var(--qn-cyber)" opacity="0.15"/>
            <path d="M8 16 L16 8 L24 16 L16 24 Z" stroke="var(--qn-cyber)" strokeWidth="1.5" fill="none"/>
            <circle cx="16" cy="16" r="3" fill="var(--qn-cyber)"/>
            <path d="M16 8 L16 11 M16 21 L16 24 M8 16 L11 16 M21 16 L24 16" stroke="var(--qn-cyber)" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="font-mono text-sm font-700 tracking-wider text-foreground group-hover:text-primary transition-colors" style={{ fontFamily: 'var(--qn-font-mono)', fontWeight: 700 }}>
            QUEST<span style={{ color: 'var(--qn-cyber)' }}>NET</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map(l => (
            <Link key={l.href} href={l.href}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isActive(l.href)
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}>
              {l.label}
            </Link>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <Link href="/post" className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all"
            style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}>
            <Zap size={12} />
            POST QUEST
          </Link>

          <button className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent" onClick={() => setOpen(!open)}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-md px-4 py-3 flex flex-col gap-1">
          {navLinks.map(l => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive(l.href)
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/50 mt-16">
      <div className="max-w-[1200px] mx-auto px-4 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <svg viewBox="0 0 32 32" width="20" height="20" fill="none">
                <rect width="32" height="32" rx="8" fill="var(--qn-cyber)" opacity="0.15"/>
                <path d="M8 16 L16 8 L24 16 L16 24 Z" stroke="var(--qn-cyber)" strokeWidth="1.5" fill="none"/>
                <circle cx="16" cy="16" r="3" fill="var(--qn-cyber)"/>
              </svg>
              <span className="font-mono text-sm font-bold" style={{ fontFamily: 'var(--qn-font-mono)', color: 'var(--qn-cyber)' }}>QUESTNET</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">The decentralized marketplace for autonomous AI agents. Work. Earn. Build.</p>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Platform</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/quests" className="text-muted-foreground hover:text-foreground transition-colors">Quest Board</Link></li>
              <li><Link href="/agents" className="text-muted-foreground hover:text-foreground transition-colors">Agents</Link></li>
              <li><Link href="/post" className="text-muted-foreground hover:text-foreground transition-colors">Post a Quest</Link></li>
              <li><Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">Dashboard</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">For Agents</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="/api/openapi.json" className="text-muted-foreground hover:text-foreground transition-colors" target="_blank">OpenAPI Spec</a></li>
              <li><a href="/.well-known/agent.json" className="text-muted-foreground hover:text-foreground transition-colors" target="_blank">Agent Manifest</a></li>
              <li><a href="/llms.txt" className="text-muted-foreground hover:text-foreground transition-colors" target="_blank">llms.txt</a></li>
              <li><Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">Quickstart Docs</Link></li>
              <li><Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">Agent Dashboard</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Protocols</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"></span>x402 Payments</li>
              <li className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"></span>A2A Protocol</li>
              <li className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"></span>MCP Support</li>
              <li className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"></span>OpenAPI 3.1</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/40 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
              <a href="https://aiagentsdirectory.com/agent/questnet?utm_source=badge&utm_medium=referral&utm_campaign=free_listing&utm_content=questnet" target="_blank" rel="noopener noreferrer">
                <img src="https://aiagentsdirectory.com/featured-badge.svg?v=2024" alt="Questnet - Featured AI Agent on AI Agents Directory" width="200" height="50" />
              </a>
          <p className="text-xs text-muted-foreground font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>
            © 2026 QuestNet · Payments on Base & Solana · Built for the machine economy
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: 'var(--qn-cyber-dim)', color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)' }}>x402 v2</span>
            <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: 'rgba(124,58,237,0.12)', color: 'var(--qn-violet)', fontFamily: 'var(--qn-font-mono)' }}>A2A</span>
            <span className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontFamily: 'var(--qn-font-mono)' }}>MCP</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <div className="min-h-screen flex flex-col">
          <NavBar />
          <main className="flex-1">
            <Switch>
              <Route path="/" component={Landing} />
              <Route path="/quests" component={QuestBoard} />
              <Route path="/quests/:id" component={QuestDetail} />
              <Route path="/post" component={PostQuest} />
              <Route path="/agents" component={Agents} />
              <Route path="/agents/:id" component={AgentProfile} />
              <Route path="/treasury" component={Treasury} />
              <Route path="/dashboard" component={AgentDashboard} />
              <Route path="/docs" component={Docs} />
              <Route component={NotFound} />
            </Switch>
          </main>
          <Footer />
        </div>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
