import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { fetchSubgraphEvents } from "@/lib/history/subgraph";
import { fetchHistoricalTokenPriceUsd } from "@/lib/history/prices";
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

type StrategyEventInsert = {
  user_id: string;
  wallet_id: string;
  protocol: Protocol;
  chain: string;
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_timestamp: string;
  event_type: string;
  asset_address: string | null;
  asset_symbol: string | null;
  asset_decimals: number | null;
  amount_raw: string | null;
  amount: string | null;
  price_usd: number | null;
  amount_usd: number | null;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(
      batch.map((item, idx) => mapper(item, i + idx)),
    );
    results.push(...batchResults);
  }
  return results;
}

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
  const includePrices = Boolean(body?.includePrices);
  const maxDaysRaw = Number(body?.maxDays ?? 90);
  const maxDays = Number.isFinite(maxDaysRaw) ? Math.max(1, maxDaysRaw) : 90;
  const maxEventsRaw = Number(body?.maxEvents ?? 2000);
  const maxEvents = Number.isFinite(maxEventsRaw)
    ? Math.max(100, Math.min(10000, maxEventsRaw))
    : 2000;
  const overrideFromTimestamp = Number(body?.fromTimestamp);
  const forceFromTimestamp = Boolean(body?.forceFromTimestamp);
  const reset = Boolean(body?.reset);
  if (!walletId) {
    return NextResponse.json({ error: "walletId required" }, { status: 400 });
  }

  const byAddress = isAddress(walletId);
  const walletLookup = byAddress ? walletId.toLowerCase() : walletId;
  const { data: wallet, error: walletError } = await supabase
    .from("user_wallets")
    .select("id,user_id,address,chain,protocol")
    .eq(byAddress ? "address" : "id", walletLookup)
    .eq("user_id", user.id)
    .maybeSingle();

  if (walletError) {
    console.error("history.events.wallet", walletError);
    return NextResponse.json({ error: "Failed to load wallet" }, { status: 500 });
  }

  if (!wallet) {
    return NextResponse.json(
      { error: byAddress ? "Wallet not found for this address" : "Wallet not found" },
      { status: 404 },
    );
  }

  if (!wallet.address || !isAddress(wallet.address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  const protocol = (wallet.protocol ?? "aave") as Protocol;
  const chainNorm = (wallet.chain ?? "")
    .toLowerCase()
    .replace(/^arbitrum-one$/i, "arbitrum");

  if (reset) {
    const { error: deleteEventsError } = await supabase
      .from("strategy_events")
      .delete()
      .eq("wallet_id", wallet.id)
      .eq("user_id", user.id);
    if (deleteEventsError) {
      console.error("history.events.reset", deleteEventsError);
      return NextResponse.json(
        { error: "Failed to reset events", detail: deleteEventsError.message },
        { status: 500 },
      );
    }
    await supabase
      .from("strategy_event_sync")
      .delete()
      .eq("wallet_id", wallet.id)
      .eq("user_id", user.id);
  }

  const { data: syncState } = await supabase
    .from("strategy_event_sync")
    .select("wallet_id,last_synced_timestamp,last_synced_block")
    .eq("wallet_id", wallet.id)
    .maybeSingle();

  const lastTimestamp = toTimestamp(
    (syncState as SyncRow | null)?.last_synced_timestamp ?? null,
  );
  const minTimestamp = Math.floor(Date.now() / 1000) - maxDays * 24 * 60 * 60;
  const fromTimestamp = Number.isFinite(overrideFromTimestamp)
    ? Math.max(0, Math.floor(overrideFromTimestamp))
    : forceFromTimestamp
      ? minTimestamp
      : Math.max(lastTimestamp, minTimestamp);

  try {
    const events = await fetchSubgraphEvents({
      protocol,
      chain: chainNorm,
      address: wallet.address,
      fromTimestamp,
      maxEvents,
    });

    const inserts: StrategyEventInsert[] = events.map((event) => {
      const amountUsd = event.amountUsdRaw
        ? Number(event.amountUsdRaw)
        : null;
      const amountNumeric = event.amount ? Number(event.amount) : NaN;
      const amountUsdNumeric =
        amountUsd !== null && Number.isFinite(amountUsd) ? amountUsd : NaN;
      const priceUsd =
        Number.isFinite(amountNumeric) &&
        Number.isFinite(amountUsdNumeric) &&
        amountNumeric > 0
          ? amountUsdNumeric / amountNumeric
          : null;

      return {
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
        price_usd: Number.isFinite(priceUsd ?? NaN) ? priceUsd : null,
        amount_usd: Number.isFinite(amountUsdNumeric) ? amountUsdNumeric : null,
      };
    });

    if (includePrices) {
      const enriched = await mapWithConcurrency(inserts, 2, async (row) => {
        if (row.amount_usd && Number.isFinite(row.amount_usd)) {
          return row;
        }
        if (!row.asset_address || !row.block_timestamp) {
          return row;
        }
        const timestampSec = Math.floor(
          new Date(row.block_timestamp).getTime() / 1000,
        );
        const priceUsd = await fetchHistoricalTokenPriceUsd({
          chain: wallet.chain,
          tokenAddress: row.asset_address,
          timestampSec,
        }).catch(() => null);
        if (!priceUsd || !Number.isFinite(priceUsd)) {
          return row;
        }
        const amountNumeric = row.amount ? Number(row.amount) : NaN;
        const amountUsd =
          Number.isFinite(amountNumeric) && Number.isFinite(priceUsd)
            ? amountNumeric * priceUsd
            : null;
        return {
          ...row,
          price_usd: priceUsd,
          amount_usd: amountUsd,
        };
      });
      inserts.splice(0, inserts.length, ...enriched);
    }

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

    const eventTypeCounts = inserts.reduce<Record<string, number>>((acc, row) => {
      const t = row.event_type || "unknown";
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      synced: events.length,
      lastTimestamp: maxTimestamp,
      eventTypeCounts,
    });
  } catch (error) {
    console.error("history.events.fetch", error);
    const detail = error instanceof Error ? error.message : String(error);
    const hint =
      protocol === "compound"
        ? " Para Compound: verifica COMPOUND_SUBGRAPH_BASE_EVENTS (ou ARBITRUM_EVENTS) em .env.local, que a URL do The Graph inclui a API key (ex.: .../api/<API_KEY>/subgraphs/id/... ou define GRAPH_API_KEY), e reinicia o servidor (npm run dev)."
        : "";
    const debug =
      protocol === "compound"
        ? {
            GRAPH_API_KEY: process.env.GRAPH_API_KEY ? "set" : "not set",
            COMPOUND_SUBGRAPH_BASE_EVENTS: process.env
              .COMPOUND_SUBGRAPH_BASE_EVENTS
              ? "set"
              : "not set",
            COMPOUND_SUBGRAPH_ARBITRUM_EVENTS: process.env
              .COMPOUND_SUBGRAPH_ARBITRUM_EVENTS
              ? "set"
              : "not set",
          }
        : undefined;
    return NextResponse.json(
      {
        error: "Failed to fetch subgraph events",
        detail: detail + hint,
        ...(debug && { debug }),
      },
      { status: 500 },
    );
  }
}
