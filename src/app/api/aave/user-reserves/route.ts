import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { applyIndex, toUsd } from "@/lib/aave/math";
import { formatUnits } from "viem";
import { coerceBool } from "@/lib/aave/normalize";
import { fetchReservesData, fetchUserReservesData } from "@/lib/aave/queries";
import { fetchAssetPrices } from "@/lib/aave/protocolDataProvider";
import { parseAaveChain } from "@/lib/aave/chains";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const chain = parseAaveChain(searchParams.get("chain")) ?? "polygon";

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const [reservesData, userReservesData] = await Promise.all([
      fetchReservesData(chain),
      fetchUserReservesData(address, chain),
    ]);

    const { reserves, baseCurrency } = reservesData;
    const { userReserves } = userReservesData;

    const reserveMap = new Map(
      reserves.map((reserve) => [
        reserve.underlyingAsset.toLowerCase(),
        reserve,
      ]),
    );

    const priceAssets = userReserves
      .filter(
        (reserve) =>
          reserve.scaledATokenBalance > BigInt(0) ||
          reserve.scaledVariableDebt > BigInt(0) ||
          reserve.principalStableDebt > BigInt(0),
      )
      .map((reserve) => reserve.underlyingAsset.toLowerCase());
    const priceMap = await fetchAssetPrices(
      priceAssets as `0x${string}`[],
      chain,
    );

    const normalized = userReserves.map((reserve) => {
      const asset = reserveMap.get(reserve.underlyingAsset.toLowerCase());
      if (!asset) {
        return null;
      }

      const isScaled =
        "isScaled" in reserve ? Boolean(reserve.isScaled) : true;
      const aTokenBalance = isScaled
        ? applyIndex(reserve.scaledATokenBalance, asset.liquidityIndex)
        : reserve.scaledATokenBalance;
      const variableDebt = isScaled
        ? applyIndex(reserve.scaledVariableDebt, asset.variableBorrowIndex)
        : reserve.scaledVariableDebt;
      const stableDebt = reserve.principalStableDebt;
      const totalDebt = variableDebt + stableDebt;

      const collateralAmount = Number(
        formatUnits(aTokenBalance, Number(asset.decimals)),
      );
      const debtAmount = Number(
        formatUnits(totalDebt, Number(asset.decimals)),
      );

      const priceInMarketReferenceCurrency =
        priceMap.get(reserve.underlyingAsset.toLowerCase()) ?? BigInt(0);

      const collateralUsd = toUsd({
        amount: aTokenBalance,
        decimals: Number(asset.decimals),
        priceInMarketReferenceCurrency,
        marketReferenceCurrencyUnit: baseCurrency.marketReferenceCurrencyUnit,
        marketReferenceCurrencyPriceInUsd:
          baseCurrency.marketReferenceCurrencyPriceInUsd,
        priceDecimals: baseCurrency.networkBaseTokenPriceDecimals,
      });

      const debtUsd = toUsd({
        amount: totalDebt,
        decimals: Number(asset.decimals),
        priceInMarketReferenceCurrency,
        marketReferenceCurrencyUnit: baseCurrency.marketReferenceCurrencyUnit,
        marketReferenceCurrencyPriceInUsd:
          baseCurrency.marketReferenceCurrencyPriceInUsd,
        priceDecimals: baseCurrency.networkBaseTokenPriceDecimals,
      });

      return {
        underlyingAsset: reserve.underlyingAsset,
        symbol: asset.symbol,
        decimals: Number(asset.decimals),
        collateralAmount,
        debtAmount,
        usageAsCollateralEnabledOnUser: coerceBool(
          reserve.usageAsCollateralEnabledOnUser,
        ),
        scaledATokenBalance: reserve.scaledATokenBalance.toString(),
        scaledVariableDebt: reserve.scaledVariableDebt.toString(),
        principalStableDebt: reserve.principalStableDebt.toString(),
        aTokenBalance: aTokenBalance.toString(),
        variableDebt: variableDebt.toString(),
        stableDebt: stableDebt.toString(),
        totalDebt: totalDebt.toString(),
        collateralUsd,
        debtUsd,
        priceInUsd: toUsd({
          amount: BigInt(10) ** BigInt(asset.decimals),
          decimals: Number(asset.decimals),
          priceInMarketReferenceCurrency,
          marketReferenceCurrencyUnit: baseCurrency.marketReferenceCurrencyUnit,
          marketReferenceCurrencyPriceInUsd:
            baseCurrency.marketReferenceCurrencyPriceInUsd,
          priceDecimals: baseCurrency.networkBaseTokenPriceDecimals,
        }),
      };
    });

    return NextResponse.json({
      reserves: normalized.filter(Boolean),
      userEmodeCategory: 0,
    });
  } catch (error) {
    console.error("aave.user-reserves", error);
    return NextResponse.json(
      { error: "Failed to fetch user reserves" },
      { status: 500 },
    );
  }
}
