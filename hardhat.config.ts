import type { HardhatUserConfig } from "hardhat/config";
import HardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

import * as dotenv from "dotenv";

dotenv.config();

const xdcKey = process.env.XDC_PRIVATE_KEY ?? "";
const xdcAccounts = xdcKey ? [xdcKey.startsWith("0x") ? xdcKey : `0x${xdcKey}`] : [];

const config: HardhatUserConfig = {
  plugins: [HardhatToolboxViem],
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    xdcTestnet: {
      url: process.env.XDC_RPC_URL ?? "https://erpc.apothem.network",
      type: "http",
      chainId: 51,
      accounts: xdcAccounts,
    },
  },
};

export default config;
