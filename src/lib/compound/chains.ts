export type CompoundChain = "arbitrum";

export const SUPPORTED_COMPOUND_CHAINS: CompoundChain[] = ["arbitrum"];

export const DEFAULT_COMPOUND_CHAIN: CompoundChain = "arbitrum";

export function parseCompoundChain(value: string | null): CompoundChain | null {
  if (!value) return null;
  return SUPPORTED_COMPOUND_CHAINS.includes(value as CompoundChain)
    ? (value as CompoundChain)
    : null;
}

export function getCometAddress(chain: CompoundChain): `0x${string}` {
  if (chain === "arbitrum") {
    const address = process.env.COMPOUND_COMET_ARBITRUM;
    if (!address) {
      throw new Error("Missing COMPOUND_COMET_ARBITRUM");
    }
    return address as `0x${string}`;
  }
  throw new Error(`Unsupported Compound chain: ${chain}`);
}
