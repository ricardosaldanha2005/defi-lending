import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    walletId,
    chain,
    totalCollateralUsd,
    totalDebtUsd,
    healthFactor,
    liquidationThresholdBps,
  } = body ?? {};

  if (!walletId || !chain) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data: wallet } = await supabase
    .from("user_wallets")
    .select("id")
    .eq("id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!wallet) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  const { error } = await supabase.from("strategy_snapshots").insert({
    user_id: user.id,
    wallet_id: walletId,
    chain,
    total_collateral_usd: totalCollateralUsd ?? 0,
    total_debt_usd: totalDebtUsd ?? 0,
    health_factor: healthFactor ?? 0,
    liquidation_threshold_bps: liquidationThresholdBps ?? 0,
  });

  if (error) {
    console.error("history.snapshot", error);
    return NextResponse.json({ error: "Failed to insert snapshot" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
