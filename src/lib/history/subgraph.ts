import { formatUnits } from "viem";

import { parseAaveChain } from "@/lib/aave/chains";
import { parseCompoundChain } from "@/lib/compound/chains";
import { Protocol } from "@/lib/protocols";

type NormalizedEvent = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: number;
  eventType: string;
  assetAddress: string | null;
  assetSymbol: string | null;
  assetDecimals: number | null;
  amountRaw: string | null;
  amount: string | null;
};

type FetchParams = {
  protocol: Protocol;
  chain: string;
  address: string;
  fromTimestamp: number;
};

const AAVE_SUBGRAPHS: Record<string, string | undefined> = {
  polygon: process.env.AAVE_SUBGRAPH_POLYGON,
  arbitrum: process.env.AAVE_SUBGRAPH_ARBITRUM,
};

const COMPOUND_SUBGRAPHS: Record<string, string | undefined> = {
  arbitrum: process.env.COMPOUND_SUBGRAPH_ARBITRUM,
  base: process.env.COMPOUND_SUBGRAPH_BASE,
};

const PAGE_SIZE = 1000;

function getSubgraphUrl(protocol: Protocol, chain: string) {
  if (protocol === "compound") {
    const parsed = parseCompoundChain(chain);
    return parsed ? COMPOUND_SUBGRAPHS[parsed] ?? null : null;
  }
  const parsed = parseAaveChain(chain);
  return parsed ? AAVE_SUBGRAPHS[parsed] ?? null : null;
}

async function postGraphQL<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; errors?: { message?: string }[] }
    | null;

  if (!response.ok || !payload?.data) {
    const message = payload?.errors?.[0]?.message;
    throw new Error(message || "Subgraph request failed.");
  }

  return payload.data;
}

function isIntegerString(value: string) {
  return /^[0-9]+$/.test(value);
}

function normalizeAmount(
  amountRaw: string | null,
  decimals: number | null,
): string | null {
  if (!amountRaw) return null;
  if (decimals == null) return amountRaw;
  if (!isIntegerString(amountRaw)) return amountRaw;
  try {
    return formatUnits(BigInt(amountRaw), decimals);
  } catch {
    return amountRaw;
  }
}

function normalizeEvent(params: {
  txHash?: string;
  logIndex?: number | string;
  blockNumber?: number | string;
  timestamp?: number | string;
  eventType?: string;
  assetAddress?: string | null;
  assetSymbol?: string | null;
  assetDecimals?: number | string | null;
  amountRaw?: string | null;
}): NormalizedEvent | null {
  const txHash = params.txHash ?? "";
  if (!txHash) return null;
  const logIndex = Number(params.logIndex ?? 0);
  const timestamp = Number(params.timestamp ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const blockNumber = Number(params.blockNumber ?? 0);
  const assetDecimals =
    params.assetDecimals !== undefined && params.assetDecimals !== null
      ? Number(params.assetDecimals)
      : null;
  const amountRaw = params.amountRaw ?? null;
  const amount = normalizeAmount(amountRaw, assetDecimals);

  return {
    txHash,
    logIndex: Number.isFinite(logIndex) ? logIndex : 0,
    blockNumber: Number.isFinite(blockNumber) ? blockNumber : 0,
    timestamp,
    eventType: params.eventType ?? "UNKNOWN",
    assetAddress: params.assetAddress ?? null,
    assetSymbol: params.assetSymbol ?? null,
    assetDecimals: Number.isFinite(assetDecimals) ? assetDecimals : null,
    amountRaw,
    amount,
  };
}

export async function fetchSubgraphEvents({
  protocol,
  chain,
  address,
  fromTimestamp,
}: FetchParams): Promise<NormalizedEvent[]> {
  const url = getSubgraphUrl(protocol, chain);
  if (!url) {
    throw new Error("Missing subgraph URL for protocol/chain.");
  }
  const lowerAddress = address.toLowerCase();

  if (protocol === "compound") {
    return fetchCompoundEvents(url, lowerAddress, fromTimestamp);
  }
  return fetchAaveEvents(url, lowerAddress, fromTimestamp);
}

async function fetchAaveEvents(
  url: string,
  address: string,
  fromTimestamp: number,
) {
  const query = `
    query UserTransactions($user: String!, $from: Int!, $skip: Int!) {
      userTransactions(
        where: { user: $user, timestamp_gte: $from }
        orderBy: timestamp
        orderDirection: asc
        first: ${PAGE_SIZE}
        skip: $skip
      ) {
        id
        timestamp
        action
        amount
        txHash
        logIndex
        blockNumber
        reserve {
          symbol
          underlyingAsset
          decimals
        }
      }
    }
  `;

  const events: NormalizedEvent[] = [];
  let skip = 0;
  while (true) {
    const data = await postGraphQL<{
      userTransactions?: Array<Record<string, unknown>>;
    }>(url, query, {
      user: address,
      from: Math.max(0, Math.floor(fromTimestamp)),
      skip,
    });
    const batch = data.userTransactions ?? [];
    for (const raw of batch) {
      const reserve = (raw.reserve as Record<string, unknown>) ?? null;
      const normalized = normalizeEvent({
        txHash: (raw.txHash as string) ?? (raw.transactionHash as string),
        logIndex: raw.logIndex as number | string | undefined,
        blockNumber: raw.blockNumber as number | string | undefined,
        timestamp: raw.timestamp as number | string | undefined,
        eventType: raw.action as string | undefined,
        assetAddress: reserve?.underlyingAsset as string | undefined,
        assetSymbol: reserve?.symbol as string | undefined,
        assetDecimals: reserve?.decimals as number | string | undefined,
        amountRaw: raw.amount as string | undefined,
      });
      if (normalized) events.push(normalized);
    }
    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return events;
}

async function fetchCompoundEvents(
  url: string,
  address: string,
  fromTimestamp: number,
) {
  const query = `
    query AccountEvents($user: String!, $from: Int!, $skip: Int!) {
      accountEvents(
        where: { account: $user, timestamp_gte: $from }
        orderBy: timestamp
        orderDirection: asc
        first: ${PAGE_SIZE}
        skip: $skip
      ) {
        id
        timestamp
        eventType
        type
        amount
        logIndex
        blockNumber
        transactionHash
        asset {
          id
          symbol
          decimals
        }
      }
    }
  `;

  const events: NormalizedEvent[] = [];
  let skip = 0;
  while (true) {
    const data = await postGraphQL<{
      accountEvents?: Array<Record<string, unknown>>;
    }>(url, query, {
      user: address,
      from: Math.max(0, Math.floor(fromTimestamp)),
      skip,
    });
    const batch = data.accountEvents ?? [];
    for (const raw of batch) {
      const asset = (raw.asset as Record<string, unknown>) ?? null;
      const normalized = normalizeEvent({
        txHash: (raw.transactionHash as string) ?? (raw.txHash as string),
        logIndex: raw.logIndex as number | string | undefined,
        blockNumber: raw.blockNumber as number | string | undefined,
        timestamp: raw.timestamp as number | string | undefined,
        eventType: (raw.eventType as string) ?? (raw.type as string),
        assetAddress: asset?.id as string | undefined,
        assetSymbol: asset?.symbol as string | undefined,
        assetDecimals: asset?.decimals as number | string | undefined,
        amountRaw: raw.amount as string | undefined,
      });
      if (normalized) events.push(normalized);
    }
    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return events;
}
