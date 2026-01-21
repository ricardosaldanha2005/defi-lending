import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { fetchSubgraphEvents } from "@/lib/history/subgraph";
import { fetchHistoricalTokenPriceUsd } from "@/lib/history/prices";
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

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Fetch all wallets
  const { data: wallets, error: walletsError } = await supabase
    .from("user_wallets")
    .select("id,user_id,address,chain,protocol")
    .not("protocol", "is", null);

  if (walletsError) {
    console.error("cron.events-sync.wallets", walletsError);
    return NextResponse.json(
      { error: "Failed to load wallets" },
      { status: 500 },
    );
  }

  if (!wallets || wallets.length === 0) {
    return NextResponse.json({ synced: 0, wallets: 0 });
  }

  // Fetch sync state for all wallets
  const walletIds = wallets.map((w) => w.id);
  const { data: syncStates } = await supabase
    .from("strategy_event_sync")
    .select("wallet_id,last_synced_timestamp,last_synced_block")
    .in("wallet_id", walletIds);

  const syncMap = new Map<string, SyncRow>();
  (syncStates || []).forEach((row) => {
    syncMap.set(row.wallet_id, row);
  });

  let totalSynced = 0;
  const maxDays = 7; // Only sync last 7 days for cron
  const maxEvents = 500; // Limit events per wallet
  const now = Math.floor(Date.now() / 1000);
  const fromTimestamp = now - maxDays * 24 * 60 * 60;

  const results = await mapWithConcurrency(
    wallets as WalletRow[],
    5, // Process 5 wallets concurrently
    async (wallet) => {
      try {
        const syncState = syncMap.get(wallet.id);
        const lastTimestamp = toTimestamp(syncState?.last_synced_timestamp);
        // Start from last sync or fromTimestamp (whichever is more recent)
        const startTimestamp = Math.max(lastTimestamp, fromTimestamp);

        if (startTimestamp >= now) {
          return { walletId: wallet.id, synced: 0, error: null };
        }

        const events = await fetchSubgraphEvents({
          protocol: wallet.protocol!,
          chain: wallet.chain,
          address: wallet.address,
          fromTimestamp: startTimestamp,
          maxEvents,
        });

        if (events.length === 0) {
          // Update sync state even if no events
          await supabase
            .from("strategy_event_sync")
            .upsert(
              {
                wallet_id: wallet.id,
                last_synced_timestamp: now,
                last_synced_block: null,
              },
              { onConflict: "wallet_id" },
            );
          return { walletId: wallet.id, synced: 0, error: null };
        }

        // Fetch prices if needed
        const eventsWithPrices = await Promise.all(
          events.map(async (event) => {
            let priceUsd = event.amountUsdRaw
              ? Number(event.amountUsdRaw)
              : null;
            let amountUsd = priceUsd;

            if (
              !priceUsd &&
              event.assetAddress &&
              event.assetSymbol &&
              event.timestamp
            ) {
              try {
                const historicalPrice = await fetchHistoricalTokenPriceUsd(
                  event.assetAddress,
                  event.assetSymbol,
                  event.timestamp,
                );
                if (historicalPrice) {
                  priceUsd = historicalPrice;
                  if (event.amount) {
                    amountUsd = Number(event.amount) * historicalPrice;
                  }
                }
              } catch (error) {
                console.warn(
                  "cron.events-sync.price",
                  event.assetSymbol,
                  error,
                );
              }
            }

            return {
              user_id: wallet.user_id,
              wallet_id: wallet.id,
              protocol: wallet.protocol!,
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
              price_usd: priceUsd,
              amount_usd: amountUsd,
            } as StrategyEventInsert;
          }),
        );

        // Insert events (ignore conflicts)
        const { error: insertError } = await supabase
          .from("strategy_events")
          .upsert(eventsWithPrices, {
            onConflict: "wallet_id,tx_hash,log_index",
            ignoreDuplicates: true,
          });

        if (insertError) {
          console.error("cron.events-sync.insert", wallet.id, insertError);
          return { walletId: wallet.id, synced: 0, error: insertError.message };
        }

        // Update sync state
        const lastEvent = events[events.length - 1];
        await supabase
          .from("strategy_event_sync")
          .upsert(
            {
              wallet_id: wallet.id,
              last_synced_timestamp: lastEvent.timestamp,
              last_synced_block: lastEvent.blockNumber,
            },
            { onConflict: "wallet_id" },
          );

        return {
          walletId: wallet.id,
          synced: events.length,
          error: null,
        };
      } catch (error) {
        console.error("cron.events-sync.wallet", wallet.id, error);
        return {
          walletId: wallet.id,
          synced: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const errors = results.filter((r) => r.error);

  return NextResponse.json({
    synced: totalSynced,
    wallets: wallets.length,
    processed: results.length,
    errors: errors.length,
    errorDetails: errors.slice(0, 5), // Limit error details
  });
}
