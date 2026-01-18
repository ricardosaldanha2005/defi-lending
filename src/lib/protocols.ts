export type Protocol = "aave" | "compound";

export const SUPPORTED_PROTOCOLS: Protocol[] = ["aave", "compound"];

export const DEFAULT_PROTOCOL: Protocol = "aave";

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  aave: "Aave",
  compound: "Compound",
};
