import { NextResponse } from "next/server";

import { fetchCompoundBaseAsset } from "@/lib/compound/queries";
import { parseCompoundChain } from "@/lib/compound/chains";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chain = parseCompoundChain(searchParams.get("chain")) ?? "arbitrum";

  try {
    const baseAsset = await fetchCompoundBaseAsset(chain);
    return NextResponse.json({
      recommended: baseAsset.symbol,
      candidates: [
        {
          symbol: baseAsset.symbol,
          priceInUsd: baseAsset.priceInUsd,
        },
      ],
      protocol: "compound",
      chain,
    });
  } catch (error) {
    console.error("compound.rates", error);
    return NextResponse.json(
      { error: "Failed to fetch rates" },
      { status: 500 },
    );
  }
}
