import { createPublicClient, http } from "viem";
import { arbitrum, base } from "viem/chains";

import { CompoundChain, DEFAULT_COMPOUND_CHAIN } from "@/lib/compound/chains";

const defaultArbitrumRpcUrl = "https://arb1.arbitrum.io/rpc";
const defaultBaseRpcUrl = "https://mainnet.base.org";

export function getCompoundPublicClient(
  chain: CompoundChain = DEFAULT_COMPOUND_CHAIN,
) {
  if (chain === "base") {
    return createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL ?? defaultBaseRpcUrl),
    });
  }
  return createPublicClient({
    chain: arbitrum,
    transport: http(process.env.ARBITRUM_RPC_URL ?? defaultArbitrumRpcUrl),
  });
}
