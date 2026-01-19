import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { fetchCompoundUserReserves } from "@/lib/compound/queries";
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
    const { reserves, baseSymbol, comet } = await fetchCompoundUserReserves(
      address as `0x${string}`,
      chain,
    );

    return NextResponse.json({
      reserves,
      market: {
        baseSymbol,
        comet,
      },
      protocol: "compound",
      chain,
    });
  } catch (error) {
    console.error("compound.user-reserves", error);
    return NextResponse.json(
      {
        error: "Failed to fetch user reserves",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
