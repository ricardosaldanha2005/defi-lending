import { NextResponse } from "next/server";

import { fetchReservesData } from "@/lib/aave/queries";
import { coerceBool, reservePriceUsd } from "@/lib/aave/normalize";
import { rayToPercent } from "@/lib/aave/math";
import { parseAaveChain } from "@/lib/aave/chains";

export async function GET(request: Request) {
  try {
    const chain =
      parseAaveChain(new URL(request.url).searchParams.get("chain")) ??
      "polygon";
    const { reserves, baseCurrency } = await fetchReservesData(chain);

    const normalized = reserves.map((reserve) => ({
      underlyingAsset: reserve.underlyingAsset,
      name: reserve.name,
      symbol: reserve.symbol,
      decimals: Number(reserve.decimals),
      borrowingEnabled: coerceBool(reserve.borrowingEnabled),
      usageAsCollateralEnabled: coerceBool(reserve.usageAsCollateralEnabled),
      isActive: coerceBool(reserve.isActive),
      isFrozen: coerceBool(reserve.isFrozen),
      liquidityRate: reserve.liquidityRate.toString(),
      variableBorrowRate: reserve.variableBorrowRate.toString(),
      liquidityApr: rayToPercent(reserve.liquidityRate),
      variableBorrowApr: rayToPercent(reserve.variableBorrowRate),
      availableLiquidity: reserve.availableLiquidity.toString(),
      priceInMarketReferenceCurrency:
        reserve.priceInMarketReferenceCurrency.toString(),
      priceInUsd: reservePriceUsd(reserve, baseCurrency),
    }));

    return NextResponse.json({
      reserves: normalized,
      baseCurrency: {
        marketReferenceCurrencyUnit:
          baseCurrency.marketReferenceCurrencyUnit.toString(),
        marketReferenceCurrencyPriceInUsd:
          baseCurrency.marketReferenceCurrencyPriceInUsd.toString(),
        networkBaseTokenPriceDecimals: baseCurrency.networkBaseTokenPriceDecimals,
      },
    });
  } catch (error) {
    console.error("aave.reserves", error);
    return NextResponse.json(
      { error: "Failed to fetch reserves data" },
      { status: 500 },
    );
  }
}
