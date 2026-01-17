import { createPublicClient, http } from "viem";
import { arbitrum, polygon } from "viem/chains";

import { AaveChain, DEFAULT_AAVE_CHAIN } from "@/lib/aave/addresses";

const defaultRpcUrl = "https://polygon-rpc.com";
const defaultArbitrumRpcUrl = "https://arb1.arbitrum.io/rpc";

export function getPublicClient(chain: AaveChain = DEFAULT_AAVE_CHAIN) {
  const isArbitrum = chain === "arbitrum";
  return createPublicClient({
    chain: isArbitrum ? arbitrum : polygon,
    transport: http(
      isArbitrum
        ? process.env.ARBITRUM_RPC_URL ?? defaultArbitrumRpcUrl
        : process.env.POLYGON_RPC_URL ?? defaultRpcUrl,
    ),
  });
}
