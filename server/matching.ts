// server/matching.ts
// Tier 1+2 capability matching engine.
// Scores quests against agents using capability overlap + performance weighting.

export interface MatchScore {
  id: number;
  score: number;           // 0.0 - 1.0
  capabilityOverlap: number; // 0.0 - 1.0
  performanceScore: number;  // 0.0 - 1.0
  reasons: string[];         // human-readable match reasons
}

// Category → capability tag mappings
// Quests in a category implicitly require these capabilities
const CATEGORY_CAPABILITIES: Record<string, string[]> = {
  data:          ["data-fetch", "web-search", "data-aggregation", "JSON-parsing", "API-calls", "scraping", "oracle", "price-feeds"],
  research:      ["research", "summarization", "fact-checking", "citation", "web-search", "PDF-parsing"],
  code:          ["solidity", "python", "javascript", "typescript", "smart-contracts", "auditing", "code-review", "debugging"],
  compute:       ["compute", "ML", "inference", "data-processing", "batch", "GPU"],
  trade:         ["DeFi-analysis", "price-feeds", "on-chain-data", "yield-farming", "trading", "arbitrage"],
  communication: ["messaging", "notifications", "translation", "summarization", "Slack", "email"],
  general:       [],
  other:         [],
};

// Normalize a capability string for fuzzy matching
function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_\s]/g, "");
}

// Check if two capability strings are a match (exact or fuzzy)
function capabilitiesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Score overlap between two capability lists
function overlapScore(agentCaps: string[], questCaps: string[]): { score: number; matched: string[] } {
  if (questCaps.length === 0) return { score: 0.5, matched: [] }; // no requirements = neutral
  const matched: string[] = [];
  for (const qc of questCaps) {
    if (agentCaps.some(ac => capabilitiesMatch(ac, qc))) {
      matched.push(qc);
    }
  }
  return { score: matched.length / questCaps.length, matched };
}

// Performance score from agent stats (0.0 - 1.0)
function performanceScore(rating: number, completedQuests: number): number {
  const ratingScore = (rating - 1) / 4; // 1-5 → 0-1
  const completionScore = Math.min(completedQuests / 20, 1); // caps at 20 completions
  return (ratingScore * 0.6) + (completionScore * 0.4);
}

export interface AgentForMatching {
  id: number;
  capabilities: string; // JSON string
  rating: number;
  completedQuests: number;
  agentType: string;
}

export interface QuestForMatching {
  id: number;
  category: string;
  requiredCapabilities: string; // JSON string
  tags: string; // JSON string
  title: string;
  bountyUsdc: number;
  priority: string;
}

/**
 * Score a single agent against a single quest.
 */
export function scoreAgentForQuest(agent: AgentForMatching, quest: QuestForMatching): MatchScore {
  const agentCaps: string[] = JSON.parse(agent.capabilities || "[]");
  const requiredCaps: string[] = JSON.parse(quest.requiredCapabilities || "[]");
  const questTags: string[] = JSON.parse(quest.tags || "[]");
  const categoryCaps = CATEGORY_CAPABILITIES[quest.category] ?? [];

  // Build full quest capability signal: requiredCaps + category defaults + tags
  const combined = [...requiredCaps, ...categoryCaps, ...questTags];
  const fullQuestCaps = combined.filter((v, i) => combined.indexOf(v) === i);

  // Capability overlap
  const { score: capScore, matched } = overlapScore(agentCaps, fullQuestCaps);

  // Category-type bonus: agentType matches quest category
  const typeBonus = agent.agentType === quest.category ? 0.1 : 0;

  // Performance score
  const perfScore = performanceScore(agent.rating, agent.completedQuests);

  // Weighted final score
  // Capability overlap is most important (50%), performance matters (35%), type bonus (10%), base (5%)
  const finalScore = Math.min(
    (capScore * 0.50) + (perfScore * 0.35) + typeBonus + 0.05,
    1.0
  );

  const reasons: string[] = [];
  if (matched.length > 0) reasons.push(`Matches: ${matched.slice(0, 3).join(", ")}`);
  if (agent.completedQuests > 0) reasons.push(`${agent.completedQuests} quests completed`);
  if (agent.rating >= 4.5) reasons.push(`${agent.rating.toFixed(1)}★ rating`);
  if (typeBonus > 0) reasons.push(`Specialist: ${agent.agentType}`);

  return {
    id: agent.id,
    score: Math.round(finalScore * 100) / 100,
    capabilityOverlap: Math.round(capScore * 100) / 100,
    performanceScore: Math.round(perfScore * 100) / 100,
    reasons,
  };
}

/**
 * Rank a list of agents for a given quest. Returns top N sorted by score.
 */
export function rankAgentsForQuest(agents: AgentForMatching[], quest: QuestForMatching, topN = 5): MatchScore[] {
  return agents
    .map(agent => scoreAgentForQuest(agent, quest))
    .filter(s => s.score > 0.1) // filter out totally irrelevant agents
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/**
 * Rank a list of quests for a given agent. Returns top N sorted by score.
 */
export function rankQuestsForAgent(quests: QuestForMatching[], agent: AgentForMatching, topN = 10): (MatchScore & { bountyUsdc: number; priority: string })[] {
  return quests
    .map(quest => ({
      ...scoreAgentForQuest(agent, quest),
      id: quest.id,
      bountyUsdc: quest.bountyUsdc,
      priority: quest.priority,
    }))
    .filter(s => s.score > 0.1)
    .sort((a, b) => {
      // Sort by score, but boost urgent/high priority quests
      const priorityBoost: Record<string, number> = { urgent: 0.15, high: 0.08, normal: 0, low: -0.05 };
      const aFinal = a.score + (priorityBoost[a.priority] ?? 0);
      const bFinal = b.score + (priorityBoost[b.priority] ?? 0);
      return bFinal - aFinal;
    })
    .slice(0, topN);
}
