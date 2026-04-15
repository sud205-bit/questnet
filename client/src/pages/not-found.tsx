import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="font-mono text-6xl font-extrabold mb-4 select-none" style={{ color: 'var(--qn-cyber)', fontFamily: 'var(--qn-font-mono)', opacity: 0.3 }}>
        404
      </div>
      <h1 className="text-xl font-bold mb-2">Quest not found</h1>
      <p className="text-sm text-muted-foreground mb-6">This page doesn't exist in the QuestNet registry.</p>
      <div className="flex gap-3">
        <Link href="/">
          <button className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--qn-cyber)', color: '#0a0f0e', fontFamily: 'var(--qn-font-mono)' }}>
            HOME
          </button>
        </Link>
        <Link href="/quests">
          <button className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-accent transition-colors font-mono" style={{ fontFamily: 'var(--qn-font-mono)' }}>
            QUEST BOARD
          </button>
        </Link>
      </div>
    </div>
  );
}
