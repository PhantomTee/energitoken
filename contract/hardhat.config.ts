import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// Ethereum Sepolia replaced Polygon Amoy as the deployment target on
// 2026-08-31. Amoy's faucets had become effectively unobtainable without an
// existing mainnet balance, and the oracle wallet was down to about nine
// transactions of gas with no way to top it up. Sepolia's faucets are
// reachable, and its gas price at the time of the switch was 1.0 gwei
// against Amoy's 37.5, so the same faucet drip goes roughly thirty times
// further. The Amoy network entry is kept so the original deployment stays
// reproducible.
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const AMOY_RPC_URL = process.env.AMOY_RPC_URL || "https://polygon-amoy-bor-rpc.publicnode.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

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
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
    amoy: {
      url: AMOY_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 80002,
    },
  },
};

export default config;
