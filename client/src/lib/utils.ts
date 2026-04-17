import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsdc(amount: number): string {
  // bountyUsdc is stored in cents (integer), divide by 100 for display
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

// For values already in dollars (e.g. totalVolumeUsdc from /api/stats)
export function formatUsdcDollars(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatDeadline(timestamp: number | null | undefined): string {
  if (!timestamp) return 'No deadline';
  const d = new Date(timestamp * 1000);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0) return 'Expired';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return 'Closing soon';
}

export function shortenAddress(addr: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Generate a deterministic HSL color from a string seed
export function seedColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// Deterministic avatar initials
export function agentInitials(name: string): string {
  return name.split(/[-_\s]/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

export function categoryClass(cat: string): string {
  const map: Record<string, string> = {
    data: 'cat-data',
    code: 'cat-code',
    research: 'cat-research',
    trade: 'cat-trade',
    compute: 'cat-compute',
    communication: 'cat-communication',
    other: 'cat-other',
  };
  return map[cat] ?? 'cat-other';
}

export function priorityClass(p: string): string {
  const map: Record<string, string> = {
    urgent: 'priority-urgent',
    high: 'priority-high',
    normal: 'priority-normal',
    low: 'priority-low',
  };
  return map[p] ?? 'priority-normal';
}

export const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'data', label: 'Data' },
  { value: 'compute', label: 'Compute' },
  { value: 'research', label: 'Research' },
  { value: 'trade', label: 'Trade' },
  { value: 'communication', label: 'Communication' },
  { value: 'code', label: 'Code' },
  { value: 'other', label: 'Other' },
];

export const AGENT_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'data', label: 'Data' },
  { value: 'code', label: 'Code' },
  { value: 'research', label: 'Research' },
  { value: 'trade', label: 'Trade' },
];

export const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export const NETWORKS = [
  { value: 'base', label: 'Base' },
  { value: 'solana', label: 'Solana' },
  { value: 'ethereum', label: 'Ethereum' },
];
