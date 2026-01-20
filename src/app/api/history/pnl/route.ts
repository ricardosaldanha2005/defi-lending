import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

type PnlRow = {
  event_type: string;
  amount_usd: number | null;
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

  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabase
    .from("strategy_events")
    .select("event_type,amount_usd")
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

  (data as PnlRow[] | null | undefined)?.forEach((row) => {
    const amountUsd = Number(row.amount_usd ?? 0);
    if (!Number.isFinite(amountUsd)) return;
    const kind = classifyEvent(row.event_type ?? "");
    if (kind === "supply") totals.supplyUsd += amountUsd;
    else if (kind === "withdraw") totals.withdrawUsd += amountUsd;
    else if (kind === "borrow") totals.borrowUsd += amountUsd;
    else if (kind === "repay") totals.repayUsd += amountUsd;
    else if (kind === "liquidation") totals.liquidationUsd += amountUsd;
    else totals.otherUsd += amountUsd;
  });

  const netCollateralFlow = totals.withdrawUsd - totals.supplyUsd;
  const netDebtFlow = totals.borrowUsd - totals.repayUsd;

  return NextResponse.json({
    walletId,
    totals,
    netCollateralFlow,
    netDebtFlow,
  });
}
