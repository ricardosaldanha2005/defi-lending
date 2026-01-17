import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { fetchUserAccountData } from "@/lib/aave/queries";
import { baseToUsd, DEFAULT_BASE_CURRENCY } from "@/lib/aave/normalize";
import { parseRayToNumber } from "@/lib/calculations";
import { parseAaveChain } from "@/lib/aave/chains";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const chain = parseAaveChain(searchParams.get("chain")) ?? "polygon";

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const accountData = await fetchUserAccountData(address, chain);
    const baseCurrency = DEFAULT_BASE_CURRENCY;
    const [
      totalCollateralBase,
      totalDebtBase,
      availableBorrowsBase,
      currentLiquidationThreshold,
      ltv,
      healthFactor,
    ] = accountData;

    const collateralUsd = baseToUsd(totalCollateralBase, baseCurrency);
    const debtUsd = baseToUsd(totalDebtBase, baseCurrency);
    const ltBps = Number(currentLiquidationThreshold);
    const hfFromTotals =
      debtUsd > 0 && ltBps > 0
        ? (collateralUsd * (ltBps / 10000)) / debtUsd
        : Infinity;
    const hfValue = parseRayToNumber(healthFactor);
    const healthFactorValue =
      Number.isFinite(hfValue) && hfValue > 0.05 ? hfValue : hfFromTotals;

    return NextResponse.json({
      totalCollateralBase: totalCollateralBase.toString(),
      totalDebtBase: totalDebtBase.toString(),
      availableBorrowsBase: availableBorrowsBase.toString(),
      currentLiquidationThreshold: ltBps,
      ltv: Number(ltv),
      healthFactorRay: healthFactor.toString(),
      totalCollateralUsd: collateralUsd,
      totalDebtUsd: debtUsd,
      availableBorrowsUsd: baseToUsd(availableBorrowsBase, baseCurrency),
      healthFactorValue,
      baseCurrency: {
        marketReferenceCurrencyUnit:
          baseCurrency.marketReferenceCurrencyUnit.toString(),
        marketReferenceCurrencyPriceInUsd:
          baseCurrency.marketReferenceCurrencyPriceInUsd.toString(),
        networkBaseTokenPriceDecimals: baseCurrency.networkBaseTokenPriceDecimals,
      },
    });
  } catch (error) {
    console.error("aave.user-account-data", error);
    return NextResponse.json(
      { error: "Failed to fetch account data" },
      { status: 500 },
    );
  }
}
