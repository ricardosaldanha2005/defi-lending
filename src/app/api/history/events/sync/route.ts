import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { fetchSubgraphEvents } from "@/lib/history/subgraph";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Protocol } from "@/lib/protocols";

type SyncRow = {
  wallet_id: string;
  last_synced_timestamp: number | null;
  last_synced_block: number | null;
};

type WalletRow = {
  id: string;
  user_id: string;
  address: string;
  chain: string;
  protocol: Protocol | null;
};

function toTimestamp(value: number | null | undefined) {
  return Number.isFinite(value ?? NaN) ? Number(value) : 0;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const walletId = body?.walletId as string | undefined;
  if (!walletId) {
    return NextResponse.json({ error: "walletId required" }, { status: 400 });
  }

  const { data: wallet, error: walletError } = await supabase
    .from("user_wallets")
    .select("id,user_id,address,chain,protocol")
    .eq("id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (walletError) {
    console.error("history.events.wallet", walletError);
    return NextResponse.json({ error: "Failed to load wallet" }, { status: 500 });
  }

  if (!wallet) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  if (!wallet.address || !isAddress(wallet.address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  const protocol = (wallet.protocol ?? "aave") as Protocol;

  const { data: syncState } = await supabase
    .from("strategy_event_sync")
    .select("wallet_id,last_synced_timestamp,last_synced_block")
    .eq("wallet_id", wallet.id)
    .maybeSingle();

  const lastTimestamp = toTimestamp(
    (syncState as SyncRow | null)?.last_synced_timestamp ?? null,
  );

  try {
    const events = await fetchSubgraphEvents({
      protocol,
      chain: wallet.chain,
      address: wallet.address,
      fromTimestamp: lastTimestamp,
    });

    const inserts = events.map((event) => ({
      user_id: wallet.user_id,
      wallet_id: wallet.id,
      protocol,
      chain: wallet.chain,
      tx_hash: event.txHash,
      log_index: event.logIndex,
      block_number: event.blockNumber,
      block_timestamp: new Date(event.timestamp * 1000).toISOString(),
      event_type: event.eventType,
      asset_address: event.assetAddress,
      asset_symbol: event.assetSymbol,
      asset_decimals: event.assetDecimals,
      amount_raw: event.amountRaw,
      amount: event.amount,
      price_usd: null,
      amount_usd: null,
    }));

    if (inserts.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < inserts.length; i += batchSize) {
        const batch = inserts.slice(i, i + batchSize);
        const { error } = await supabase
          .from("strategy_events")
          .upsert(batch, {
            onConflict: "wallet_id,tx_hash,log_index",
          });
        if (error) {
          console.error("history.events.insert", error);
          return NextResponse.json(
            { error: "Failed to insert events", detail: error.message },
            { status: 500 },
          );
        }
      }
    }

    const maxTimestamp = events.reduce(
      (acc, event) => Math.max(acc, event.timestamp),
      lastTimestamp,
    );
    const maxBlock = events.reduce(
      (acc, event) => Math.max(acc, event.blockNumber),
      Number(
        (syncState as SyncRow | null)?.last_synced_block ?? 0,
      ),
    );

    const { error: syncError } = await supabase
      .from("strategy_event_sync")
      .upsert(
        {
          wallet_id: wallet.id,
          user_id: wallet.user_id,
          protocol,
          chain: wallet.chain,
          last_synced_timestamp: maxTimestamp,
          last_synced_block: maxBlock,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_id" },
      );

    if (syncError) {
      console.error("history.events.sync", syncError);
      return NextResponse.json(
        { error: "Failed to update sync state", detail: syncError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      synced: events.length,
      lastTimestamp: maxTimestamp,
    });
  } catch (error) {
    console.error("history.events.fetch", error);
    return NextResponse.json(
      {
        error: "Failed to fetch subgraph events",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
