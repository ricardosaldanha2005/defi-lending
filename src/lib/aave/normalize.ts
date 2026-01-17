type BaseCurrencyInfo = {
  marketReferenceCurrencyUnit: bigint;
  marketReferenceCurrencyPriceInUsd: bigint;
  networkBaseTokenPriceDecimals: number;
};

export const DEFAULT_BASE_CURRENCY: BaseCurrencyInfo = {
  marketReferenceCurrencyUnit: BigInt(100000000),
  marketReferenceCurrencyPriceInUsd: BigInt(100000000),
  networkBaseTokenPriceDecimals: 8,
};

type ReserveData = {
  priceInMarketReferenceCurrency: bigint;
  decimals: bigint;
};

export function baseToUsd(
  amountBase: bigint,
  baseCurrency: BaseCurrencyInfo,
) {
  const unit = Number(baseCurrency.marketReferenceCurrencyUnit);
  const price = Number(baseCurrency.marketReferenceCurrencyPriceInUsd);
  const priceDecimals = baseCurrency.networkBaseTokenPriceDecimals;
  const amount = Number(amountBase) / unit;
  const baseUsd = price / 10 ** priceDecimals;
  return amount * baseUsd;
}

export function reservePriceUsd(
  reserve: ReserveData,
  baseCurrency: BaseCurrencyInfo,
) {
  const price = Number(reserve.priceInMarketReferenceCurrency);
  const unit = Number(baseCurrency.marketReferenceCurrencyUnit);
  const baseUsd =
    Number(baseCurrency.marketReferenceCurrencyPriceInUsd) /
    10 ** baseCurrency.networkBaseTokenPriceDecimals;
  return (price / unit) * baseUsd;
}

export function coerceBool(value: boolean | bigint | number) {
  if (typeof value === "boolean") return value;
  return Number(value) > 0;
}
