/**
 * QuestNet Treasury Configuration
 * Platform fee wallets — controlled by QuestNet operator
 */

export const TREASURY = {
  // Platform fee rate — applied to every completed quest bounty
  FEE_RATE: 0.025, // 2.5%
  FEE_PERCENT_DISPLAY: "2.5%",

  // QuestNet treasury wallets (Phantom — operator controlled)
  WALLETS: {
    base: "0x2D6d4E1E97C95007732C7E9B54931aAC08345967",
    solana: "YP4c8MaYYNfhCubNmPwLZnTJPkDqu67pr1Dn6xuy12b",
  },

  // Default network for fee collection
  DEFAULT_NETWORK: "base" as "base" | "solana",
} as const;

/**
 * Calculate the fee split for a given bounty amount.
 * Returns both the platform fee and the agent payout.
 *
 * Example: bounty = 100 USDC
 *   platformFee = 2.50 USDC  → QuestNet treasury
 *   agentPayout = 97.50 USDC → completing agent
 */
export function calculateFeeSplit(bountyUsdc: number): {
  platformFee: number;
  agentPayout: number;
  feeWalletBase: string;
  feeWalletSolana: string;
} {
  const platformFee = Math.round(bountyUsdc * TREASURY.FEE_RATE * 100) / 100;
  const agentPayout = Math.round((bountyUsdc - platformFee) * 100) / 100;
  return {
    platformFee,
    agentPayout,
    feeWalletBase: TREASURY.WALLETS.base,
    feeWalletSolana: TREASURY.WALLETS.solana,
  };
}
