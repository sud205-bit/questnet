/**
 * QuestEscrow Deployment Script (Hardhat 3 compatible)
 *
 * Usage (PowerShell):
 *   $env:RESOLVER_PRIVATE_KEY="0x..."
 *   $env:BASE_RPC_URL="https://mainnet.base.org"
 *   npx hardhat run scripts/deploy.ts --network base
 *
 * Usage (Command Prompt):
 *   set RESOLVER_PRIVATE_KEY=0x...
 *   set BASE_RPC_URL=https://mainnet.base.org
 *   npx hardhat run scripts/deploy.ts --network base
 *
 * After deployment, add to Railway:
 *   ESCROW_CONTRACT_ADDRESS=<deployed address>
 *   RESOLVER_PRIVATE_KEY=<same key used here>
 */

import hre from "hardhat";

// ── Addresses ─────────────────────────────────────────────────────────────────
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TREASURY_WALLET   = "0x2D6d4E1E97C95007732C7E9B54931aAC08345967";

async function main() {
  const { ethers } = hre as any;

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("─────────────────────────────────────────────");
  console.log("QuestEscrow Deployment");
  console.log(`Network:   ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer:  ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:   ${ethers.formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────────");

  if (balance === 0n) {
    throw new Error("Resolver wallet has 0 ETH. Fund it with ~$3 of ETH on Base first.");
  }

  const isMainnet   = chainId === 8453;
  const usdcAddress = isMainnet ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA;
  const resolver    = deployer.address;

  console.log(`USDC:      ${usdcAddress}`);
  console.log(`Treasury:  ${TREASURY_WALLET}`);
  console.log(`Resolver:  ${resolver}`);
  console.log();

  const QuestEscrow = await ethers.getContractFactory("QuestEscrow");
  console.log("Deploying QuestEscrow...");

  const escrow = await QuestEscrow.deploy(usdcAddress, TREASURY_WALLET, resolver);
  await escrow.waitForDeployment();

  const address  = await escrow.getAddress();
  const deployTx = escrow.deploymentTransaction();

  console.log("─────────────────────────────────────────────");
  console.log(`✅ QuestEscrow deployed!`);
  console.log(`   Contract:  ${address}`);
  console.log(`   Tx hash:   ${deployTx?.hash}`);
  console.log(`   BaseScan:  https://basescan.org/address/${address}`);
  console.log("─────────────────────────────────────────────");
  console.log();
  console.log("Add these to Railway environment variables:");
  console.log(`  ESCROW_CONTRACT_ADDRESS=${address}`);
  console.log(`  RESOLVER_PRIVATE_KEY=${process.env.RESOLVER_PRIVATE_KEY}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
