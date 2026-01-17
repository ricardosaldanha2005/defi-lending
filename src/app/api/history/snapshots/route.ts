import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.max(1, Number(searchParams.get("days") ?? 7));
  const walletId = searchParams.get("walletId");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("strategy_snapshots")
    .select(
      "wallet_id,chain,total_collateral_usd,total_debt_usd,health_factor,liquidation_threshold_bps,captured_at",
    )
    .eq("user_id", user.id)
    .gte("captured_at", since);

  if (walletId) {
    query = query.eq("wallet_id", walletId);
  }

  const { data, error } = await query
    .order("captured_at", { ascending: true })
    .limit(5000);

  if (error) {
    console.error("history.snapshots", error);
    return NextResponse.json({ error: "Failed to load snapshots" }, { status: 500 });
  }

  return NextResponse.json({ snapshots: data ?? [] });
}
