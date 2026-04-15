import type { HardhatUserConfig } from "hardhat/config";

const RESOLVER_PRIVATE_KEY = process.env.RESOLVER_PRIVATE_KEY || "0x" + "a".repeat(64);
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    base: {
      type: "http",
      url: BASE_RPC_URL,
      accounts: [RESOLVER_PRIVATE_KEY],
      chainId: 8453,
    },
    "base-sepolia": {
      type: "http",
      url: "https://sepolia.base.org",
      accounts: [RESOLVER_PRIVATE_KEY],
      chainId: 84532,
    },
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
};

export default config;
