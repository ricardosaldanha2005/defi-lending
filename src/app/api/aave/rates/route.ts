import { NextResponse } from "next/server";

import { BORROW_CANDIDATES } from "@/lib/constants";
import { fetchReservesData } from "@/lib/aave/queries";
import { fetchAssetPrices } from "@/lib/aave/protocolDataProvider";
import { reservePriceUsd } from "@/lib/aave/normalize";
import { rayToPercent } from "@/lib/aave/math";
import { parseAaveChain } from "@/lib/aave/chains";

export async function GET(request: Request) {
  try {
    const chain =
      parseAaveChain(new URL(request.url).searchParams.get("chain")) ??
      "polygon";
    const { reserves } = await fetchReservesData(chain);

    const filtered = reserves
      .filter((reserve) =>
        BORROW_CANDIDATES.includes(
          reserve.symbol as (typeof BORROW_CANDIDATES)[number],
        ),
      )
    const priceMap = await fetchAssetPrices(
      filtered.map((reserve) => reserve.underlyingAsset),
      chain,
    );

    const candidates = filtered
      .map((reserve) => {
        const availableLiquidity =
          typeof reserve.availableLiquidity === "bigint"
            ? reserve.availableLiquidity
            : BigInt(reserve.availableLiquidity ?? 0);
        const available =
          reserve.borrowingEnabled &&
          reserve.isActive &&
          !reserve.isFrozen &&
          availableLiquidity > 0n;
        const priceInMarketReferenceCurrency =
          priceMap.get(reserve.underlyingAsset.toLowerCase()) ?? 0n;
        const priceInUsd = reservePriceUsd(
          { priceInMarketReferenceCurrency, decimals: 8n },
          {
            marketReferenceCurrencyUnit: 100000000n,
            marketReferenceCurrencyPriceInUsd: 100000000n,
            networkBaseTokenPriceDecimals: 8,
          },
        );

        return {
          symbol: reserve.symbol,
          underlyingAsset: reserve.underlyingAsset,
          borrowingEnabled: reserve.borrowingEnabled,
          isActive: reserve.isActive,
          isFrozen: reserve.isFrozen,
          availableLiquidity: availableLiquidity.toString(),
          available,
          priceInUsd,
          variableBorrowApr: rayToPercent(reserve.variableBorrowRate),
          liquidityApr: rayToPercent(reserve.liquidityRate),
        };
      })
      .sort((a, b) => a.variableBorrowApr - b.variableBorrowApr);

    const recommended = candidates.find((candidate) => candidate.available);

    return NextResponse.json({
      candidates,
      recommended: recommended?.symbol ?? null,
    });
  } catch (error) {
    console.error("aave.rates", error);
    return NextResponse.json(
      { error: "Failed to fetch rates data" },
      { status: 500 },
    );
  }
}
