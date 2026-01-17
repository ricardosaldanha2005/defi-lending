import { formatUnits } from "viem";
import { RAY } from "@/lib/constants";

export function rayToPercent(ray: bigint) {
  return (Number(ray) / 1e27) * 100;
}

export function rayToNumber(ray: bigint) {
  return Number(ray) / 1e27;
}

export function wadToNumber(value: bigint, decimals = 18) {
  return Number(formatUnits(value, decimals));
}

export function toUsd(params: {
  amount: bigint;
  decimals: number;
  priceInMarketReferenceCurrency: bigint;
  marketReferenceCurrencyUnit: bigint;
  marketReferenceCurrencyPriceInUsd: bigint;
  priceDecimals: number;
}) {
  const amountNormalized = Number(formatUnits(params.amount, params.decimals));
  const price = Number(params.priceInMarketReferenceCurrency);
  const baseUnit = Number(params.marketReferenceCurrencyUnit);
  const basePriceUsd = Number(params.marketReferenceCurrencyPriceInUsd);
  const priceUsd =
    (price / baseUnit) * (basePriceUsd / 10 ** params.priceDecimals);

  return amountNormalized * priceUsd;
}

export function applyIndex(amount: bigint, index: bigint) {
  return (amount * index) / RAY;
}
