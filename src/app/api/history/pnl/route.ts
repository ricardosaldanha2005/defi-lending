import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Protocol } from "@/lib/protocols";

type PnlRow = {
  event_type: string;
  amount_usd: number | null;
  asset_address: string | null;
  asset_symbol: string | null;
  amount: number | null;
  price_usd: number | null;
};

type AssetPosition = {
  address: string;
  symbol: string;
  collateralAmount: number;
  collateralUsd: number;
  debtAmount: number;
  debtUsd: number;
  priceInUsd: number;
};

function classifyEvent(type: string) {
  const key = type.toLowerCase();
  if (key.includes("borrow")) return "borrow";
  if (key.includes("repay")) return "repay";
  if (key.includes("supply") || key.includes("deposit")) return "supply";
  if (key.includes("withdraw")) return "withdraw";
  if (key.includes("liquidat")) return "liquidation";
  return "other";
}

async function fetchCurrentPosition(
  address: string,
  chain: string,
  protocol: Protocol,
): Promise<AssetPosition[]> {
  try {
    const protocolPath = protocol === "compound" ? "compound" : "aave";
    // Use relative URL - will work in both dev and production
    const url = new URL(
      `/api/${protocolPath}/user-reserves?address=${address}&chain=${chain}`,
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    );
    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        // Forward any auth headers if needed
      },
    });
    if (!response.ok) {
      console.warn(
        "Failed to fetch current position",
        response.status,
        await response.text().catch(() => ""),
      );
      return [];
    }
    const data = await response.json();
    if (data.error) {
      console.warn("Error fetching current position", data.error);
      return [];
    }
    return (data.reserves || []).map((r: any) => ({
      address: (r.underlyingAsset || r.asset || "").toLowerCase(),
      symbol: r.symbol || "",
      collateralAmount: r.collateralAmount || 0,
      collateralUsd: r.collateralUsd || 0,
      debtAmount: r.debtAmount || 0,
      debtUsd: r.debtUsd || 0,
      priceInUsd: r.priceInUsd || 0,
    }));
  } catch (error) {
    console.error("Failed to fetch current position", error);
    return [];
  }
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const walletId = searchParams.get("walletId");
  if (!walletId) {
    return NextResponse.json({ error: "walletId required" }, { status: 400 });
  }

  // Fetch wallet info
  const { data: wallet, error: walletError } = await supabase
    .from("user_wallets")
    .select("address,chain,protocol")
    .eq("id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (walletError || !wallet) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // Fetch events with asset details for mark-to-market calculation
  let query = supabase
    .from("strategy_events")
    .select(
      "event_type,amount_usd,asset_address,asset_symbol,amount,price_usd",
    )
    .eq("user_id", user.id)
    .eq("wallet_id", walletId)
    .not("amount_usd", "is", null);

  if (from) {
    query = query.gte("block_timestamp", from);
  }
  if (to) {
    query = query.lte("block_timestamp", to);
  }

  const { data, error } = await query;

  if (error) {
    console.error("history.pnl", error);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }

  const totals = {
    supplyUsd: 0,
    withdrawUsd: 0,
    borrowUsd: 0,
    repayUsd: 0,
    liquidationUsd: 0,
    otherUsd: 0,
  };

  // Track cost basis by asset (for mark-to-market)
  type AssetCostBasis = {
    collateralCost: number; // Total USD cost of collateral
    collateralAmount: number; // Total amount of collateral
    debtCost: number; // Total USD cost of debt
    debtAmount: number; // Total amount of debt
  };
  const assetCostBasis = new Map<string, AssetCostBasis>();

  (data as PnlRow[] | null | undefined)?.forEach((row) => {
    const amountUsd = Number(row.amount_usd ?? 0);
    if (!Number.isFinite(amountUsd)) return;
    const kind = classifyEvent(row.event_type ?? "");

    // Update totals
    if (kind === "supply") totals.supplyUsd += amountUsd;
    else if (kind === "withdraw") totals.withdrawUsd += amountUsd;
    else if (kind === "borrow") totals.borrowUsd += amountUsd;
    else if (kind === "repay") totals.repayUsd += amountUsd;
    else if (kind === "liquidation") totals.liquidationUsd += amountUsd;
    else totals.otherUsd += amountUsd;

    // Track cost basis for mark-to-market
    const assetAddress = row.asset_address?.toLowerCase();
    if (assetAddress && row.amount && row.price_usd) {
      const amount = Number(row.amount);
      const priceUsd = Number(row.price_usd);
      if (Number.isFinite(amount) && Number.isFinite(priceUsd) && priceUsd > 0) {
        if (!assetCostBasis.has(assetAddress)) {
          assetCostBasis.set(assetAddress, {
            collateralCost: 0,
            collateralAmount: 0,
            debtCost: 0,
            debtAmount: 0,
          });
        }
        const basis = assetCostBasis.get(assetAddress)!;

        if (kind === "supply") {
          // Add to collateral cost basis (weighted average)
          basis.collateralCost += amountUsd;
          basis.collateralAmount += amount;
        } else if (kind === "withdraw") {
          // Remove from collateral proportionally (average cost method)
          if (basis.collateralAmount > 0) {
            const ratio = Math.min(1, amount / basis.collateralAmount);
            const costRemoved = basis.collateralCost * ratio;
            basis.collateralCost = Math.max(0, basis.collateralCost - costRemoved);
            basis.collateralAmount = Math.max(0, basis.collateralAmount - amount);
          }
        } else if (kind === "borrow") {
          // Add to debt cost basis
          basis.debtCost += amountUsd;
          basis.debtAmount += amount;
        } else if (kind === "repay") {
          // Remove from debt proportionally (average cost method)
          if (basis.debtAmount > 0) {
            const ratio = Math.min(1, amount / basis.debtAmount);
            const costRemoved = basis.debtCost * ratio;
            basis.debtCost = Math.max(0, basis.debtCost - costRemoved);
            basis.debtAmount = Math.max(0, basis.debtAmount - amount);
          }
        }
      }
    }
  });

  const netCollateralFlow = totals.withdrawUsd - totals.supplyUsd;
  const netDebtFlow = totals.borrowUsd - totals.repayUsd;

  // Fetch current position for mark-to-market
  const currentPositions = await fetchCurrentPosition(
    wallet.address,
    wallet.chain,
    wallet.protocol as Protocol,
  );

  // Calculate mark-to-market P&L
  let markToMarketPnl = 0;
  let currentCollateralValue = 0;
  let currentDebtValue = 0;
  let historicalCollateralCost = 0;
  let historicalDebtCost = 0;

  for (const position of currentPositions) {
    currentCollateralValue += position.collateralUsd;
    currentDebtValue += position.debtUsd;

    const assetKey = position.address.toLowerCase();
    const basis = assetCostBasis.get(assetKey);

    if (position.collateralAmount > 0) {
      if (basis && basis.collateralAmount > 0) {
        // Calculate average cost per unit from historical events
        const avgCollateralCostPerUnit = basis.collateralCost / basis.collateralAmount;
        // Current collateral cost = current amount * average cost per unit
        const currentCollateralCost = position.collateralAmount * avgCollateralCostPerUnit;
        historicalCollateralCost += currentCollateralCost;
        // P&L for collateral = Current Value - Historical Cost
        markToMarketPnl += position.collateralUsd - currentCollateralCost;
      } else {
        // No historical cost basis, assume cost = current value (no P&L)
        historicalCollateralCost += position.collateralUsd;
      }
    }

    if (position.debtAmount > 0) {
      if (basis && basis.debtAmount > 0) {
        // Calculate average cost per unit from historical events
        const avgDebtCostPerUnit = basis.debtCost / basis.debtAmount;
        // Current debt cost = current amount * average cost per unit
        const currentDebtCost = position.debtAmount * avgDebtCostPerUnit;
        historicalDebtCost += currentDebtCost;
        // P&L for debt = Historical Cost - Current Value (debt is negative)
        markToMarketPnl -= position.debtUsd - currentDebtCost;
      } else {
        // No historical cost basis, assume cost = current value (no P&L)
        historicalDebtCost += position.debtUsd;
      }
    }
  }

  return NextResponse.json({
    walletId,
    totals,
    netCollateralFlow,
    netDebtFlow,
    markToMarket: {
      pnl: markToMarketPnl,
      currentCollateralValue,
      currentDebtValue,
      historicalCollateralCost,
      historicalDebtCost,
      netPositionValue: currentCollateralValue - currentDebtValue,
      netHistoricalCost: historicalCollateralCost - historicalDebtCost,
    },
  });
}
