export function formatUsd(value: number) {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const digits = abs >= 10000 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatNumber(value: number, decimals = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatToken(value: number, symbol: string, decimals = 4) {
  if (!Number.isFinite(value)) return "-";
  return `${formatNumber(value, decimals)} ${symbol}`;
}

export function formatPercent(value: number, decimals = 2) {
  if (!Number.isFinite(value)) return "-";
  return `${formatNumber(value, decimals)}%`;
}
