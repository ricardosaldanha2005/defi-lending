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
  const walletId = searchParams.get("walletId");
  if (!walletId) {
    return NextResponse.json({ error: "walletId required" }, { status: 400 });
  }

  const limitRaw = Number(searchParams.get("limit") ?? 200);
  const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 200));
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabase
    .from("strategy_events")
    .select(
      "wallet_id,protocol,chain,tx_hash,log_index,block_number,block_timestamp,event_type,asset_address,asset_symbol,asset_decimals,amount,amount_usd,price_usd",
    )
    .eq("user_id", user.id)
    .eq("wallet_id", walletId);

  if (from) {
    query = query.gte("block_timestamp", from);
  }
  if (to) {
    query = query.lte("block_timestamp", to);
  }

  const { data, error } = await query
    .order("block_timestamp", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("history.events", error);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}
