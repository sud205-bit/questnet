/**
 * QuestNet Escrow Contract Client
 *
 * Interacts with QuestEscrow.sol deployed on Base mainnet.
 * Uses viem's walletClient (with RESOLVER_PRIVATE_KEY) to send transactions.
 *
 * Contract functions used by the server:
 *   deposit(questId, amount)        — called to verify poster locked bounty
 *   release(questId, agentWallet)   — called when quest is completed
 *   refund(questId)                 — called when quest is cancelled
 *   getEscrow(questId)              — called to read escrow state
 *
 * Contract address comes from ESCROW_CONTRACT_ADDRESS env var.
 * If not set, escrow features are disabled and the system falls back
 * to the existing x402 verification flow.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
  formatUnits,
  type Address,
  type Hash,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const ESCROW_ADDRESS = (process.env.ESCROW_CONTRACT_ADDRESS || "") as Address;
const RESOLVER_PRIVATE_KEY = process.env.RESOLVER_PRIVATE_KEY as `0x${string}` | undefined;

export const ESCROW_ENABLED = Boolean(ESCROW_ADDRESS && RESOLVER_PRIVATE_KEY);

// ── ABI (only the functions we call) ─────────────────────────────────────────
const ESCROW_ABI = parseAbi([
  "function deposit(uint256 questId, uint256 amount) external",
  "function release(uint256 questId, address agentWallet) external",
  "function refund(uint256 questId) external",
  "function getEscrow(uint256 questId) external view returns (address poster, uint256 amount, bool settled)",
  "function previewSplit(uint256 amount) external pure returns (uint256 agentAmount, uint256 feeAmount)",
  "event Released(uint256 indexed questId, address indexed agent, uint256 agentAmount, uint256 feeAmount)",
  "event Deposited(uint256 indexed questId, address indexed poster, uint256 amount)",
  "event Refunded(uint256 indexed questId, address indexed poster, uint256 amount)",
]);

// USDC on Base mainnet (6 decimals)
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const USDC_DECIMALS = 6;

// ── Clients ───────────────────────────────────────────────────────────────────
const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

function getWalletClient() {
  if (!RESOLVER_PRIVATE_KEY) throw new Error("RESOLVER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(RESOLVER_PRIVATE_KEY);
  return createWalletClient({
    account,
    chain: base,
    transport: http(BASE_RPC),
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface EscrowState {
  poster: string;
  amountUsdc: number;
  settled: boolean;
}

export interface EscrowReleaseResult {
  success: boolean;
  txHash: Hash | null;
  agentPayout: number;
  platformFee: number;
  error?: string;
}

// ── Public Functions ──────────────────────────────────────────────────────────

/**
 * Read the current escrow state for a quest from the contract.
 * Returns null if escrow is not enabled or the call fails.
 */
export async function getEscrowState(questId: number): Promise<EscrowState | null> {
  if (!ESCROW_ENABLED) return null;
  try {
    const [poster, amount, settled] = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "getEscrow",
      args: [BigInt(questId)],
    }) as [Address, bigint, boolean];
    return {
      poster,
      amountUsdc: Number(formatUnits(amount, USDC_DECIMALS)),
      settled,
    };
  } catch (err: any) {
    console.warn(`[escrow] getEscrow(${questId}) failed:`, err.message);
    return null;
  }
}

/**
 * Verify that a deposit exists on-chain for this quest.
 * Called during quest creation when poster claims they deposited.
 *
 * @param questId     The quest's DB id
 * @param depositTxHash  The tx hash the poster provided
 * @param expectedAmountUsdc  The quest bounty amount
 */
export async function verifyEscrowDeposit(
  questId: number,
  depositTxHash: Hash,
  expectedAmountUsdc: number,
): Promise<{ ok: boolean; actualAmount: number; error?: string }> {
  if (!ESCROW_ENABLED) {
    return { ok: true, actualAmount: expectedAmountUsdc }; // pass-through when escrow not deployed
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: depositTxHash });
    if (!receipt || receipt.status !== "success") {
      return { ok: false, actualAmount: 0, error: "Deposit tx not found or reverted" };
    }

    const state = await getEscrowState(questId);
    if (!state || state.amountUsdc === 0) {
      return { ok: false, actualAmount: 0, error: `No escrow deposit found for quest ${questId}` };
    }
    if (state.settled) {
      return { ok: false, actualAmount: state.amountUsdc, error: "Escrow already settled" };
    }

    const minExpected = expectedAmountUsdc * 0.99;
    if (state.amountUsdc < minExpected) {
      return { ok: false, actualAmount: state.amountUsdc, error: `Deposit too low: ${state.amountUsdc} USDC, expected ${expectedAmountUsdc}` };
    }

    return { ok: true, actualAmount: state.amountUsdc };
  } catch (err: any) {
    return { ok: false, actualAmount: 0, error: `RPC error: ${err.message}` };
  }
}

/**
 * Call release() on the escrow contract to pay out the agent.
 * The contract atomically splits 97.5% to agent, 2.5% to treasury.
 *
 * @param questId     The quest's DB id
 * @param agentWallet The completing agent's wallet address
 * @param bountyUsdc  The total bounty amount (for logging)
 */
export async function releaseEscrow(
  questId: number,
  agentWallet: string,
  bountyUsdc: number,
): Promise<EscrowReleaseResult> {
  if (!ESCROW_ENABLED) {
    return {
      success: false,
      txHash: null,
      agentPayout: bountyUsdc * 0.975,
      platformFee: bountyUsdc * 0.025,
      error: "Escrow contract not configured — use x402 flow",
    };
  }

  try {
    const walletClient = getWalletClient();

    const hash = await walletClient.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "release",
      args: [BigInt(questId), agentWallet as Address],
    });

    console.log(`[escrow] release(${questId}, ${agentWallet}) → tx ${hash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") {
      return { success: false, txHash: hash, agentPayout: 0, platformFee: 0, error: "Release tx reverted" };
    }

    const feeAmount   = bountyUsdc * 0.025;
    const agentPayout = bountyUsdc - feeAmount;

    return {
      success: true,
      txHash: hash,
      agentPayout: Math.round(agentPayout * 1e6) / 1e6,
      platformFee: Math.round(feeAmount * 1e6) / 1e6,
    };
  } catch (err: any) {
    console.error(`[escrow] release(${questId}) failed:`, err.message);
    return {
      success: false,
      txHash: null,
      agentPayout: bountyUsdc * 0.975,
      platformFee: bountyUsdc * 0.025,
      error: err.message,
    };
  }
}

/**
 * Call refund() on the escrow contract to return bounty to poster.
 *
 * @param questId The quest's DB id
 */
export async function refundEscrow(
  questId: number,
): Promise<{ success: boolean; txHash: Hash | null; error?: string }> {
  if (!ESCROW_ENABLED) {
    return { success: false, txHash: null, error: "Escrow contract not configured" };
  }

  try {
    const walletClient = getWalletClient();

    const hash = await walletClient.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "refund",
      args: [BigInt(questId)],
    });

    console.log(`[escrow] refund(${questId}) → tx ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") {
      return { success: false, txHash: hash, error: "Refund tx reverted" };
    }

    return { success: true, txHash: hash };
  } catch (err: any) {
    console.error(`[escrow] refund(${questId}) failed:`, err.message);
    return { success: false, txHash: null, error: err.message };
  }
}

/**
 * Preview the fee split for a given bounty amount (reads from contract).
 * Falls back to local calculation if contract is unavailable.
 */
export async function previewEscrowSplit(amountUsdc: number): Promise<{ agentAmount: number; feeAmount: number }> {
  const localCalc = () => ({
    feeAmount:   Math.round(amountUsdc * 0.025 * 1e6) / 1e6,
    agentAmount: Math.round(amountUsdc * 0.975 * 1e6) / 1e6,
  });

  if (!ESCROW_ENABLED) return localCalc();

  try {
    const amountRaw = parseUnits(String(amountUsdc), USDC_DECIMALS);
    const [agentRaw, feeRaw] = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "previewSplit",
      args: [amountRaw],
    }) as [bigint, bigint];
    return {
      agentAmount: Number(formatUnits(agentRaw, USDC_DECIMALS)),
      feeAmount:   Number(formatUnits(feeRaw,   USDC_DECIMALS)),
    };
  } catch {
    return localCalc();
  }
}

export { ESCROW_ADDRESS };
