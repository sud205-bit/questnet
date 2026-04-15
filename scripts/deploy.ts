/**
 * QuestEscrow Deployment Script — uses viem directly (no hardhat-ethers needed)
 *
 * Usage (PowerShell):
 *   $env:RESOLVER_PRIVATE_KEY="0x..."
 *   $env:BASE_RPC_URL="https://mainnet.base.org"
 *   npx tsx scripts/deploy.ts
 *
 * Usage (Command Prompt):
 *   set RESOLVER_PRIVATE_KEY=0x...
 *   set BASE_RPC_URL=https://mainnet.base.org
 *   npx tsx scripts/deploy.ts
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const PRIVATE_KEY   = process.env.RESOLVER_PRIVATE_KEY as `0x${string}`;
const BASE_RPC_URL  = process.env.BASE_RPC_URL || "https://mainnet.base.org";

const USDC_BASE     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TREASURY      = "0x2D6d4E1E97C95007732C7E9B54931aAC08345967";

if (!PRIVATE_KEY) {
  console.error("❌ RESOLVER_PRIVATE_KEY env var is required");
  process.exit(1);
}

// ── Load compiled artifact ────────────────────────────────────────────────────
const artifact = JSON.parse(
  readFileSync(join(__dirname, "../artifacts/QuestEscrow.json"), "utf8")
);
const abi      = artifact.abi;
const bytecode = artifact.bytecode as `0x${string}`;

// ── Clients ───────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(BASE_RPC_URL),
});

// ── Deploy ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("─────────────────────────────────────────────");
  console.log("QuestEscrow Deployment");
  console.log(`Network:   Base Mainnet`);
  console.log(`Deployer:  ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance:   ${formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────────");

  if (balance === 0n) {
    console.error("❌ Resolver wallet has 0 ETH on Base. Fund it with ~$3 of ETH first.");
    process.exit(1);
  }

  console.log(`USDC:      ${USDC_BASE}`);
  console.log(`Treasury:  ${TREASURY}`);
  console.log(`Resolver:  ${account.address}`);
  console.log();
  console.log("Deploying QuestEscrow...");

  // Encode constructor arguments: (address usdc, address treasury, address resolver)
  const { encodeDeployData } = await import("viem");
  const deployData = encodeDeployData({
    abi,
    bytecode,
    args: [USDC_BASE, TREASURY, account.address],
  });

  const txHash = await walletClient.sendTransaction({
    data: deployData,
  });

  console.log(`Tx hash:   ${txHash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (!receipt.contractAddress) {
    console.error("❌ Deploy failed — no contract address in receipt");
    process.exit(1);
  }

  const contractAddress = receipt.contractAddress;

  console.log("─────────────────────────────────────────────");
  console.log(`✅ QuestEscrow deployed!`);
  console.log(`   Contract:  ${contractAddress}`);
  console.log(`   Tx hash:   ${txHash}`);
  console.log(`   BaseScan:  https://basescan.org/address/${contractAddress}`);
  console.log("─────────────────────────────────────────────");
  console.log();
  console.log("Add these to Railway environment variables:");
  console.log(`  ESCROW_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`  RESOLVER_PRIVATE_KEY=${PRIVATE_KEY}`);
}

main().catch((err) => {
  console.error("❌", err.message || err);
  process.exit(1);
});
