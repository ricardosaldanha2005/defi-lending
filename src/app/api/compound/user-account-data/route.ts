import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { fetchCompoundAccountData } from "@/lib/compound/queries";
import { parseCompoundChain } from "@/lib/compound/chains";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const chain = parseCompoundChain(searchParams.get("chain")) ?? "arbitrum";

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const accountData = await fetchCompoundAccountData(
      address as `0x${string}`,
      chain,
    );

    return NextResponse.json({
      totalCollateralUsd: accountData.totalCollateralUsd,
      totalDebtUsd: accountData.totalDebtUsd,
      availableBorrowsUsd: accountData.availableBorrowsUsd,
      currentLiquidationThreshold: accountData.currentLiquidationThreshold,
      ltv: accountData.ltv,
      healthFactorValue: accountData.healthFactorValue,
      market: accountData.market,
      protocol: "compound",
      chain,
    });
  } catch (error) {
    console.error("compound.user-account-data", error);
    return NextResponse.json(
      {
        error: "Failed to fetch account data",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
