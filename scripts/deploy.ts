/**
 * QuestEscrow Deployment Script
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network base
 *   npx hardhat run scripts/deploy.ts --network base-sepolia   (testnet)
 *
 * Required env vars:
 *   RESOLVER_PRIVATE_KEY   — the QuestNet backend wallet private key (0x prefixed)
 *   BASE_RPC_URL           — Base mainnet RPC (default: https://mainnet.base.org)
 *
 * After deployment, set in Railway:
 *   ESCROW_CONTRACT_ADDRESS=<deployed address>
 *   RESOLVER_PRIVATE_KEY=<same key used here>
 */

import { ethers } from "hardhat";

// ── Addresses ─────────────────────────────────────────────────────────────────
const USDC_BASE_MAINNET    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_BASE_SEPOLIA    = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // testnet USDC
const TREASURY_WALLET      = "0x2D6d4E1E97C95007732C7E9B54931aAC08345967";  // QuestNet treasury

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("─────────────────────────────────────────────");
  console.log("QuestEscrow Deployment");
  console.log(`Network:   ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("─────────────────────────────────────────────");

  const isMainnet = chainId === 8453;
  const usdcAddress = isMainnet ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA;
  const resolver    = deployer.address; // resolver = deployer wallet (QuestNet backend)

  console.log(`USDC:      ${usdcAddress}`);
  console.log(`Treasury:  ${TREASURY_WALLET}`);
  console.log(`Resolver:  ${resolver}`);
  console.log();

  if (!process.env.RESOLVER_PRIVATE_KEY) {
    throw new Error("RESOLVER_PRIVATE_KEY env var is required");
  }

  // Deploy
  const QuestEscrow = await ethers.getContractFactory("QuestEscrow");
  console.log("Deploying QuestEscrow...");
  const escrow = await QuestEscrow.deploy(usdcAddress, TREASURY_WALLET, resolver);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  const deployTx = escrow.deploymentTransaction();

  console.log("─────────────────────────────────────────────");
  console.log(`✅ QuestEscrow deployed!`);
  console.log(`   Contract:  ${address}`);
  console.log(`   Tx hash:   ${deployTx?.hash}`);
  console.log(`   BaseScan:  https://basescan.org/address/${address}`);
  console.log("─────────────────────────────────────────────");
  console.log();
  console.log("Add to Railway environment variables:");
  console.log(`  ESCROW_CONTRACT_ADDRESS=${address}`);
  console.log(`  RESOLVER_PRIVATE_KEY=<your deployer key>`);
  console.log();
  console.log("The contract is now live. QuestNet server will automatically");
  console.log("use it for deposit verification and payment releases.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
