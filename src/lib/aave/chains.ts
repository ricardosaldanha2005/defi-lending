import { AaveChain } from "@/lib/aave/addresses";

export const SUPPORTED_AAVE_CHAINS: AaveChain[] = ["polygon", "arbitrum"];

export function parseAaveChain(value: string | null): AaveChain | null {
  if (!value) return null;
  return SUPPORTED_AAVE_CHAINS.includes(value as AaveChain)
    ? (value as AaveChain)
    : null;
}
