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
  amountUsdRaw?: string | null;
};

type TypeRef = {
  kind: string;
  name?: string | null;
  ofType?: TypeRef | null;
};

type QueryFieldInfo = {
  name: string;
  args: Array<{ name: string; type: TypeRef }>;
  type: TypeRef;
};

type CompoundSchemaConfig = {
  queryField: string;
  eventTypeName: string;
  fields: {
    id?: string;
    timestamp?: string;
    txHash?: string;
    logIndex?: string;
    blockNumber?: string;
    eventType?: string;
    amount?: string;
    amountUsd?: string;
  };
  whereAccountField?: string;
  whereTimestampField?: string;
  orderByField?: string;
  assetField?: string;
  assetFields?: {
    id?: string;
    symbol?: string;
    decimals?: string;
  };
};

type AaveSchemaConfig = {
  queryField: string;
  eventTypeName: string;
  fields: {
    id?: string;
    timestamp?: string;
    txHash?: string;
    logIndex?: string;
    blockNumber?: string;
    action?: string;
    amount?: string;
    amountUsd?: string;
  };
  whereUserField?: string;
  whereTimestampField?: string;
  directUserArg?: string;
  directTimestampArg?: string;
  requiresWhere?: boolean;
  orderByField?: string;
  reserveField?: string;
  assetField?: string;
  reserveNestedField?: string;
  reserveFields?: {
    symbol?: string;
    underlyingAsset?: string;
    decimals?: string;
  };
  reserveNestedFields?: {
    symbol?: string;
    underlyingAsset?: string;
    decimals?: string;
  };
  positionField?: string;
  positionMarketField?: string;
  positionMarketTokenField?: string;
  positionMarketTokenListField?: string;
  positionMarketTokenFields?: {
    symbol?: string;
    underlyingAsset?: string;
    decimals?: string;
  };
  fallbackEventType?: string;
};

type FetchParams = {
  protocol: Protocol;
  chain: string;
  address: string;
  fromTimestamp: number;
  maxEvents?: number;
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
const compoundSchemaCache = new Map<string, Promise<CompoundSchemaConfig>>();
const aaveSchemaCache = new Map<string, Promise<AaveSchemaConfig[]>>();

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

function unwrapTypeName(typeRef: TypeRef | null | undefined): string | null {
  let current = typeRef;
  while (current) {
    if (current.kind === "NON_NULL" || current.kind === "LIST") {
      current = current.ofType ?? null;
      continue;
    }
    return current.name ?? null;
  }
  return null;
}

function deriveEntityTypeName(value: string) {
  if (!value) return null;
  const base = value.endsWith("s") ? value.slice(0, -1) : value;
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : null;
}

function isRequiredArg(typeRef: TypeRef | null | undefined) {
  return typeRef?.kind === "NON_NULL";
}

function pickField(
  fields: Array<{ name: string }>,
  candidates: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (fields.some((field) => field.name === candidate)) {
      return candidate;
    }
  }
  return undefined;
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
  amountUsdRaw?: string | null;
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
  const amountUsdRaw = params.amountUsdRaw ?? null;

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
    amountUsdRaw,
  };
}

export async function fetchSubgraphEvents({
  protocol,
  chain,
  address,
  fromTimestamp,
  maxEvents,
}: FetchParams): Promise<NormalizedEvent[]> {
  const url = getSubgraphUrl(protocol, chain);
  if (!url) {
    throw new Error("Missing subgraph URL for protocol/chain.");
  }
  const lowerAddress = address.toLowerCase();

  if (protocol === "compound") {
    return fetchCompoundEvents(url, lowerAddress, fromTimestamp, maxEvents);
  }
  return fetchAaveEvents(url, lowerAddress, fromTimestamp, maxEvents);
}

async function fetchAaveEvents(
  url: string,
  address: string,
  fromTimestamp: number,
  maxEvents?: number,
) {
  const events: NormalizedEvent[] = [];
  const limit = maxEvents && maxEvents > 0 ? maxEvents : null;
  let schemas = await getAaveSchemaConfig(url);
  // Priorizar borrow/repay para a aba Histórico ter movimentos de empréstimo
  const borrowFirst = (a: { queryField: string }, b: { queryField: string }) => {
    const want = (q: string) => q.toLowerCase().includes("borrow") || q.toLowerCase().includes("repay");
    if (want(a.queryField) && !want(b.queryField)) return -1;
    if (!want(a.queryField) && want(b.queryField)) return 1;
    return 0;
  };
  schemas = [...schemas].sort(borrowFirst);
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/f851284a-e320-4111-a6b3-990427dc7984", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: "subgraph.ts:fetchAaveEvents",
      message: "Aave schema order",
      data: { schemaOrder: schemas.map((s) => s.queryField), limit },
      timestamp: Date.now(),
      sessionId: "debug-session",
      hypothesisId: "A",
    }),
  }).catch(() => {});
  // #endregion
  for (const schema of schemas) {
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/f851284a-e320-4111-a6b3-990427dc7984", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "subgraph.ts:fetchAaveEvents:loop",
        message: "Processing schema",
        data: { queryField: schema.queryField, eventsSoFar: events.length },
        timestamp: Date.now(),
        sessionId: "debug-session",
        hypothesisId: "A",
      }),
    }).catch(() => {});
    // #endregion
    const selection = buildAaveSelection(schema);
    const whereEntries: string[] = [];
    if (schema.whereUserField) {
      whereEntries.push(`${schema.whereUserField}: $user`);
    }
    if (schema.whereTimestampField) {
      whereEntries.push(`${schema.whereTimestampField}: $from`);
    }
    const directArgs: string[] = [];
    if (schema.directUserArg) {
      directArgs.push(`${schema.directUserArg}: $user`);
    }
    if (schema.directTimestampArg) {
      directArgs.push(`${schema.directTimestampArg}: $from`);
    }
    const whereClause = whereEntries.length
      ? `where: { ${whereEntries.join(", ")} }`
      : schema.requiresWhere
        ? "where: {}"
        : "";
    const orderByClause = schema.orderByField
      ? `orderBy: ${schema.orderByField}, orderDirection: asc`
      : "";
    const args = [
      ...directArgs,
      whereClause,
      orderByClause,
      `first: ${PAGE_SIZE}`,
      `skip: $skip`,
    ]
      .filter(Boolean)
      .join(", ");
    const query = `
      query UserTransactions($user: String!, $from: Int!, $skip: Int!) {
        ${schema.queryField}(${args}) {
          ${selection}
        }
      }
    `;

    let skip = 0;
    while (true) {
      const data = await postGraphQL<
        Record<string, Array<Record<string, unknown>> | undefined>
      >(url, query, {
        user: address,
        from: Math.max(0, Math.floor(fromTimestamp)),
        skip,
      });
      const batch = data[schema.queryField] ?? [];
      for (const raw of batch) {
      const reserveValue =
        schema.reserveField && raw[schema.reserveField]
          ? raw[schema.reserveField]
          : null;
      // Always try to read asset field, even if schema doesn't detect it
      let assetValue: unknown = null;
      if (schema.assetField && raw[schema.assetField]) {
        assetValue = raw[schema.assetField];
      } else if (raw.asset && typeof raw.asset === "object") {
        assetValue = raw.asset;
      }
      const positionValue =
        schema.positionField && raw[schema.positionField]
          ? raw[schema.positionField]
          : null;
      const position =
        positionValue && typeof positionValue === "object"
          ? ((positionValue as Record<string, unknown>) ?? null)
          : null;
      const positionMarket =
        position &&
        schema.positionMarketField &&
        position[schema.positionMarketField] &&
        typeof position[schema.positionMarketField] === "object"
          ? ((position[schema.positionMarketField] as Record<string, unknown>) ??
              null)
          : null;
      const positionTokenValue =
        positionMarket && schema.positionMarketTokenField
          ? positionMarket[schema.positionMarketTokenField]
          : schema.positionMarketTokenListField
            ? positionMarket?.[schema.positionMarketTokenListField]
            : null;
      const positionToken =
        Array.isArray(positionTokenValue)
          ? ((positionTokenValue[0] as Record<string, unknown> | undefined) ??
              null)
          : positionTokenValue && typeof positionTokenValue === "object"
            ? ((positionTokenValue as Record<string, unknown>) ?? null)
            : null;
      const reserve =
        reserveValue && typeof reserveValue === "object"
          ? ((reserveValue as Record<string, unknown>) ?? null)
          : null;
      const asset =
        assetValue && typeof assetValue === "object"
          ? ((assetValue as Record<string, unknown>) ?? null)
          : null;
      let nestedReserve: Record<string, unknown> | null = null;
      if (reserve && schema.reserveNestedField && reserve[schema.reserveNestedField]) {
        const nestedValue = reserve[schema.reserveNestedField];
        if (Array.isArray(nestedValue)) {
          nestedReserve =
            (nestedValue[0] as Record<string, unknown> | undefined) ?? null;
        } else {
          nestedReserve = (nestedValue as Record<string, unknown>) ?? null;
        }
      }
      const reserveAsString =
        typeof reserveValue === "string" ? reserveValue : null;
        const txHashField = schema.fields.txHash;
        const txHash =
          (txHashField ? (raw[txHashField] as string | undefined) : undefined) ??
          ((raw.id as string | undefined) ?? "");
        const normalized = normalizeEvent({
          txHash,
          logIndex: schema.fields.logIndex
            ? (raw[schema.fields.logIndex] as number | string | undefined)
            : undefined,
          blockNumber: schema.fields.blockNumber
            ? (raw[schema.fields.blockNumber] as number | string | undefined)
            : undefined,
          timestamp: schema.fields.timestamp
            ? (raw[schema.fields.timestamp] as number | string | undefined)
            : undefined,
          eventType: schema.fields.action
            ? (raw[schema.fields.action] as string | undefined)
            : schema.fallbackEventType,
        assetAddress: schema.reserveNestedFields?.underlyingAsset
          ? (nestedReserve?.[
              schema.reserveNestedFields.underlyingAsset
            ] as string | undefined)
          : schema.reserveFields?.underlyingAsset
            ? (reserve?.[schema.reserveFields.underlyingAsset] as
                | string
                | undefined)
            : reserve?.id && typeof reserve.id === "string"
              ? reserve.id
              : asset?.id && typeof asset.id === "string"
                ? asset.id
                : schema.positionMarketTokenFields?.underlyingAsset
                  ? (positionToken?.[
                      schema.positionMarketTokenFields.underlyingAsset
                    ] as string | undefined)
                  : positionToken?.id && typeof positionToken.id === "string"
                    ? positionToken.id
                : reserveAsString ?? undefined,
        assetSymbol: schema.reserveNestedFields?.symbol
          ? (nestedReserve?.[
              schema.reserveNestedFields.symbol
            ] as string | undefined)
          : schema.reserveFields?.symbol
            ? (reserve?.[schema.reserveFields.symbol] as string | undefined)
            : reserve?.symbol && typeof reserve.symbol === "string"
              ? reserve.symbol
              : asset?.symbol && typeof asset.symbol === "string"
                ? asset.symbol
                : schema.positionMarketTokenFields?.symbol
                  ? (positionToken?.[
                      schema.positionMarketTokenFields.symbol
                    ] as string | undefined)
                  : positionToken?.symbol && typeof positionToken.symbol === "string"
                    ? positionToken.symbol
            : undefined,
        assetDecimals: schema.reserveNestedFields?.decimals
          ? (nestedReserve?.[
              schema.reserveNestedFields.decimals
            ] as number | string | undefined)
          : schema.reserveFields?.decimals
            ? (reserve?.[schema.reserveFields.decimals] as number | string | undefined)
            : reserve?.decimals && typeof reserve.decimals === "number"
              ? reserve.decimals
              : asset?.decimals && typeof asset.decimals === "number"
                ? asset.decimals
                : schema.positionMarketTokenFields?.decimals
                  ? (positionToken?.[
                      schema.positionMarketTokenFields.decimals
                    ] as number | string | undefined)
                  : positionToken?.decimals && typeof positionToken.decimals === "number"
                    ? positionToken.decimals
            : undefined,
          amountRaw: schema.fields.amount
            ? (raw[schema.fields.amount] as string | undefined)
            : undefined,
          amountUsdRaw: schema.fields.amountUsd
            ? (raw[schema.fields.amountUsd] as string | undefined)
            : undefined,
        });
        if (normalized) events.push(normalized);
        if (limit && events.length >= limit) {
          // #region agent log
          fetch("http://127.0.0.1:7242/ingest/f851284a-e320-4111-a6b3-990427dc7984", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              location: "subgraph.ts:fetchAaveEvents:limit",
              message: "Limit reached, returning early",
              data: { queryField: schema.queryField, totalEvents: events.length },
              timestamp: Date.now(),
              sessionId: "debug-session",
              hypothesisId: "A",
            }),
          }).catch(() => {});
          // #endregion
          return events.slice(0, limit);
        }
      }
      if (batch.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }
    if (limit && events.length >= limit) {
      break;
    }
  }
  return events;
}

async function getAaveSchemaConfig(url: string): Promise<AaveSchemaConfig[]> {
  if (!aaveSchemaCache.has(url)) {
    aaveSchemaCache.set(url, resolveAaveSchemaConfig(url));
  }
  return aaveSchemaCache.get(url)!;
}

async function resolveAaveSchemaConfig(url: string): Promise<AaveSchemaConfig[]> {
  const data = await postGraphQL<{
    __schema?: { queryType?: { fields?: QueryFieldInfo[] } };
  }>(
    url,
    `
      query SchemaInfo {
        __schema {
          queryType {
            fields {
              name
              type { kind name ofType { kind name ofType { kind name } } }
              args {
                name
                type { kind name ofType { kind name ofType { kind name } } }
              }
            }
          }
        }
      }
    `,
    {},
  );

  const fields = data.__schema?.queryType?.fields ?? [];
  const namedCandidates = [
    "userTransactions",
    "transactions",
    "userTransaction",
    "userTransactionsV2",
    "userActivities",
    "userActivity",
    "activities",
    "events",
  ];
  const queryFieldName =
    pickField(fields, namedCandidates) ??
    fields.find((field) => field.name.toLowerCase().includes("transaction"))
      ?.name ??
    fields.find((field) => field.name.toLowerCase().includes("activity"))?.name;
  const directMatch = queryFieldName
    ? fields.find((field) => field.name === queryFieldName)
    : undefined;

  const configs: AaveSchemaConfig[] = [];
  if (directMatch) {
    const resolved = await buildAaveConfigFromField(url, directMatch);
    if (resolved) configs.push(resolved);
  }

  for (const field of fields) {
    if (configs.some((config) => config.queryField === field.name)) {
      continue;
    }
    const candidate = await buildAaveConfigFromField(url, field);
    if (candidate) configs.push(candidate);
  }

  // Garantir borrows/repays para a aba Histórico: se existirem no schema mas não
  // entraram nos configs (ex.: required args diferentes), adicionar config mínimo.
  const borrowRepayNames = ["borrows", "repays"];
  for (const name of borrowRepayNames) {
    if (configs.some((c) => c.queryField === name)) continue;
    const field = fields.find((f) => f.name === name);
    if (!field) continue;
    const requiredArgs = field.args
      .filter((arg) => isRequiredArg(arg.type))
      .map((arg) => arg.name);
    const supportedRequired = new Set(["user", "account", "from", "skip", "where"]);
    if (requiredArgs.some((arg) => !supportedRequired.has(arg))) continue;
    configs.push({
      queryField: field.name,
      eventTypeName: unwrapTypeName(field.type) ?? name,
      fields: {
        id: "id",
        timestamp: "timestamp",
        txHash: "transactionHash",
        logIndex: "logIndex",
        blockNumber: "blockNumber",
        action: "eventType",
        amount: "amount",
        amountUsd: "amountUSD",
      },
      orderByField: "timestamp",
      fallbackEventType: field.name,
      whereUserField: "user",
      requiresWhere: true,
    });
  }

  if (configs.length > 0) {
    return configs;
  }

  const fallbackNames = [
    "deposits",
    "withdraws",
    "borrows",
    "repays",
    "liquidates",
    "transfers",
    "flashloans",
    "events",
    "event",
  ];
  const fallbackFields = fields.filter((field) =>
    fallbackNames.includes(field.name),
  );
  if (fallbackFields.length > 0) {
    return fallbackFields.map((field) => ({
      queryField: field.name,
      eventTypeName: field.name,
      fields: {
        id: "id",
        timestamp: "timestamp",
        amount: "amount",
        amountUsd: "amountUSD",
      },
      orderByField: "timestamp",
      fallbackEventType: field.name,
    }));
  }

  throw new Error(
    `Aave subgraph has no transaction query field. Available: ${fields
      .map((field) => field.name)
      .join(", ")}`,
  );
}

async function buildAaveConfigFromField(
  url: string,
  queryField: QueryFieldInfo,
): Promise<AaveSchemaConfig | null> {
  const requiredArgs = queryField.args
    .filter((arg) => isRequiredArg(arg.type))
    .map((arg) => arg.name);
  const supportedRequired = new Set(["user", "account", "from", "skip", "where"]);
  if (requiredArgs.some((arg) => !supportedRequired.has(arg))) {
    return null;
  }

  const eventTypeName =
    unwrapTypeName(queryField.type) ?? deriveEntityTypeName(queryField.name);
  if (!eventTypeName) return null;

  const eventTypeInfo = await postGraphQL<{
    __type?: { fields?: Array<{ name: string; type: TypeRef }> };
  }>(
    url,
    `
      query EventType($name: String!) {
        __type(name: $name) {
          fields {
            name
            type { kind name ofType { kind name ofType { kind name } } }
          }
        }
      }
    `,
    { name: eventTypeName },
  );

  const eventFields = eventTypeInfo.__type?.fields ?? [];
  if (eventFields.length === 0) {
    return {
      queryField: queryField.name,
      eventTypeName,
      fields: {
        id: "id",
        timestamp: "timestamp",
        txHash: "transactionHash",
        logIndex: "logIndex",
        blockNumber: "blockNumber",
        action: "eventType",
        amount: "amount",
        amountUsd: "amountUSD",
      },
      orderByField: "timestamp",
      fallbackEventType: queryField.name,
    };
  }
  const timestampField = pickField(eventFields, [
    "timestamp",
    "blockTimestamp",
    "block_timestamp",
  ]);
  const txHashField = pickField(eventFields, [
    "txHash",
    "transactionHash",
    "hash",
  ]);
  const logIndexField = pickField(eventFields, ["logIndex", "log_index"]);
  const blockNumberField = pickField(eventFields, ["blockNumber", "block_number"]);
  const actionField = pickField(eventFields, ["action", "eventType", "type"]);
  const amountField = pickField(eventFields, [
    "amount",
    "value",
    "amountBeforeFee",
    "amountAfterFee",
  ]);
  const amountUsdField = pickField(eventFields, [
    "amountUSD",
    "amountUsd",
    "amountInUSD",
    "amount_usd",
  ]);
  const reserveField = pickField(eventFields, [
    "asset",
    "market",
    "reserve",
    "token",
    "inputToken",
  ]);
  const assetField = pickField(eventFields, ["asset"]);
  const positionField = pickField(eventFields, ["position"]);
  if (!timestampField) {
    return null;
  }

  let reserveFields: AaveSchemaConfig["reserveFields"];
  let reserveNestedField: string | undefined;
  let reserveNestedFields: AaveSchemaConfig["reserveNestedFields"];
  if (reserveField) {
    const reserveTypeName = unwrapTypeName(
      eventFields.find((field) => field.name === reserveField)?.type,
    );
    if (reserveTypeName) {
      const reserveTypeInfo = await postGraphQL<{
        __type?: { fields?: Array<{ name: string }> };
      }>(
        url,
        `
          query ReserveType($name: String!) {
            __type(name: $name) {
              fields { name }
            }
          }
        `,
        { name: reserveTypeName },
      );
      const reserveTypeFields = reserveTypeInfo.__type?.fields ?? [];
      reserveNestedField = pickField(reserveTypeFields, [
        "asset",
        "inputToken",
        "inputTokens",
        "outputToken",
        "token",
      ]);
      if (reserveNestedField) {
        const reserveTypeInfoDetailed = await postGraphQL<{
          __type?: { fields?: Array<{ name: string; type: TypeRef }> };
        }>(
          url,
          `
            query ReserveTypeFields($name: String!) {
              __type(name: $name) {
                fields {
                  name
                  type { kind name ofType { kind name ofType { kind name } } }
                }
              }
            }
          `,
          { name: reserveTypeName },
        );
        const nestedTypeName = unwrapTypeName(
          reserveTypeInfoDetailed.__type?.fields?.find(
            (field) => field.name === reserveNestedField,
          )?.type,
        );
        if (nestedTypeName) {
          const nestedTypeInfo = await postGraphQL<{
            __type?: { fields?: Array<{ name: string }> };
          }>(
            url,
            `
              query ReserveNestedType($name: String!) {
                __type(name: $name) {
                  fields { name }
                }
              }
            `,
            { name: nestedTypeName },
          );
          const nestedFields = nestedTypeInfo.__type?.fields ?? [];
          reserveNestedFields = {
            symbol: pickField(nestedFields, ["symbol", "name"]),
            underlyingAsset: pickField(nestedFields, [
              "id",
              "tokenAddress",
              "address",
            ]),
            decimals: pickField(nestedFields, ["decimals"]),
          };
        }
      }
      const underlyingAssetField = pickField(reserveTypeFields, [
        "underlyingAsset",
        "underlyingAssetAddress",
        "tokenAddress",
        "id",
      ]);
      reserveFields = {
        symbol: pickField(reserveTypeFields, ["symbol", "name"]) ?? "symbol",
        underlyingAsset: underlyingAssetField ?? "id",
        decimals: pickField(reserveTypeFields, ["decimals"]) ?? "decimals",
      };
    }
  }

  let positionMarketField: string | undefined;
  let positionMarketTokenField: string | undefined;
  let positionMarketTokenListField: string | undefined;
  let positionMarketTokenFields: AaveSchemaConfig["positionMarketTokenFields"];

  if (positionField) {
    const positionTypeName = unwrapTypeName(
      eventFields.find((field) => field.name === positionField)?.type,
    );
    if (positionTypeName) {
      const positionTypeInfo = await postGraphQL<{
        __type?: { fields?: Array<{ name: string; type: TypeRef }> };
      }>(
        url,
        `
          query PositionType($name: String!) {
            __type(name: $name) {
              fields {
                name
                type { kind name ofType { kind name ofType { kind name } } }
              }
            }
          }
        `,
        { name: positionTypeName },
      );
      const positionFields = positionTypeInfo.__type?.fields ?? [];
      positionMarketField = pickField(positionFields, ["market"]);
      if (positionMarketField) {
        const marketTypeName = unwrapTypeName(
          positionFields.find((field) => field.name === positionMarketField)?.type,
        );
        if (marketTypeName) {
          const marketTypeInfo = await postGraphQL<{
            __type?: { fields?: Array<{ name: string; type: TypeRef }> };
          }>(
            url,
            `
              query MarketType($name: String!) {
                __type(name: $name) {
                  fields {
                    name
                    type { kind name ofType { kind name ofType { kind name } } }
                  }
                }
              }
            `,
            { name: marketTypeName },
          );
          const marketFields = marketTypeInfo.__type?.fields ?? [];
          positionMarketTokenField = pickField(marketFields, [
            "inputToken",
            "outputToken",
            "asset",
            "token",
          ]);
          positionMarketTokenListField = pickField(marketFields, ["inputTokens"]);
          const tokenTypeName = unwrapTypeName(
            marketFields.find(
              (field) =>
                field.name ===
                (positionMarketTokenField ?? positionMarketTokenListField),
            )?.type,
          );
          if (tokenTypeName) {
            const tokenTypeInfo = await postGraphQL<{
              __type?: { fields?: Array<{ name: string }> };
            }>(
              url,
              `
                query MarketTokenType($name: String!) {
                  __type(name: $name) {
                    fields { name }
                  }
                }
              `,
              { name: tokenTypeName },
            );
            const tokenFields = tokenTypeInfo.__type?.fields ?? [];
            positionMarketTokenFields = {
              symbol: pickField(tokenFields, ["symbol", "name"]) ?? "symbol",
              underlyingAsset:
                pickField(tokenFields, ["id", "tokenAddress", "address"]) ?? "id",
              decimals: pickField(tokenFields, ["decimals"]) ?? "decimals",
            };
          }
        }
      }
    }
  }

  const directUserArg = queryField.args.find((arg) =>
    ["user", "account"].includes(arg.name),
  )?.name;
  const directTimestampArg = queryField.args.find((arg) =>
    ["from", "fromTimestamp", "timestamp_gte"].includes(arg.name),
  )?.name;

  const whereArg = queryField.args.find((arg) => arg.name === "where");
  const whereTypeName = whereArg ? unwrapTypeName(whereArg.type) : null;
  let whereUserField: string | undefined;
  let whereTimestampField: string | undefined;
  if (whereTypeName) {
    const whereTypeInfo = await postGraphQL<{
      __type?: { inputFields?: Array<{ name: string }> };
    }>(
      url,
      `
        query WhereType($name: String!) {
          __type(name: $name) {
            inputFields { name }
          }
        }
      `,
      { name: whereTypeName },
    );
    const whereFields = whereTypeInfo.__type?.inputFields ?? [];
    whereUserField = pickField(whereFields, [
      "user",
      "account",
      "from",
      "to",
      "user_",
      "account_",
      "from_",
      "to_",
    ]);
    whereTimestampField = pickField(whereFields, [
      "timestamp_gte",
      "blockTimestamp_gte",
      "timestamp_gt",
    ]);
  }

  return {
    queryField: queryField.name,
    eventTypeName,
    fields: {
      id: pickField(eventFields, ["id"]),
      timestamp: timestampField,
      txHash: txHashField,
      logIndex: logIndexField,
      blockNumber: blockNumberField,
      action: actionField,
      amount: amountField,
      amountUsd: amountUsdField,
    },
    whereUserField,
    whereTimestampField,
    directUserArg,
    directTimestampArg,
    requiresWhere: requiredArgs.includes("where"),
    orderByField: timestampField,
    reserveField,
    assetField,
    reserveNestedField,
    reserveFields,
    reserveNestedFields,
    positionField,
    positionMarketField,
    positionMarketTokenField,
    positionMarketTokenListField,
    positionMarketTokenFields,
    fallbackEventType: queryField.name,
  };
}

function buildAaveSelection(schema: AaveSchemaConfig) {
  const fields: string[] = [];
  if (schema.fields.id) fields.push(schema.fields.id);
  if (schema.fields.timestamp) fields.push(schema.fields.timestamp);
  if (schema.fields.action) fields.push(schema.fields.action);
  if (schema.fields.amount) fields.push(schema.fields.amount);
  if (schema.fields.amountUsd) fields.push(schema.fields.amountUsd);
  if (schema.fields.logIndex) fields.push(schema.fields.logIndex);
  if (schema.fields.blockNumber) fields.push(schema.fields.blockNumber);
  if (schema.fields.txHash) fields.push(schema.fields.txHash);
  
  // Always try to include asset field as fallback
  let hasAssetField = false;
  
  if (schema.assetField && schema.reserveField !== "asset") {
    fields.push("asset { id symbol decimals }");
    hasAssetField = true;
  }
  if (schema.reserveField) {
    if (schema.reserveField === "asset") {
      fields.push("asset { id symbol decimals }");
      hasAssetField = true;
      return fields.join("\n");
    }
    const reserveFields = [
      schema.reserveFields?.symbol,
      schema.reserveFields?.underlyingAsset,
      schema.reserveFields?.decimals,
    ].filter(Boolean);
    if (schema.reserveNestedField && schema.reserveNestedFields) {
      const nestedFields = [
        schema.reserveNestedFields.symbol,
        schema.reserveNestedFields.underlyingAsset,
        schema.reserveNestedFields.decimals,
      ].filter(Boolean);
      if (nestedFields.length > 0) {
        fields.push(
          `${schema.reserveField} { ${schema.reserveNestedField} { ${nestedFields.join(" ")} } }`,
        );
      } else {
        fields.push(`${schema.reserveField} { ${schema.reserveNestedField} { id } }`);
      }
    } else if (reserveFields.length > 0) {
      fields.push(
        `${schema.reserveField} { ${reserveFields.join(" ")} }`,
      );
    } else {
      fields.push(`${schema.reserveField} { id symbol decimals }`);
    }
  }
  if (schema.positionField && schema.positionMarketField) {
    const tokenFields = [
      schema.positionMarketTokenFields?.underlyingAsset,
      schema.positionMarketTokenFields?.symbol,
      schema.positionMarketTokenFields?.decimals,
    ].filter(Boolean);
    const tokenSelection =
      tokenFields.length > 0 ? tokenFields.join(" ") : "id symbol decimals";
    if (schema.positionMarketTokenField) {
      fields.push(
        `${schema.positionField} { ${schema.positionMarketField} { ${schema.positionMarketTokenField} { ${tokenSelection} } } }`,
      );
    } else if (schema.positionMarketTokenListField) {
      fields.push(
        `${schema.positionField} { ${schema.positionMarketField} { ${schema.positionMarketTokenListField} { ${tokenSelection} } } }`,
      );
    }
  }
  
  // Always include asset as fallback if not already included
  if (!hasAssetField && !fields.some(f => f.includes("asset {"))) {
    fields.push("asset { id symbol decimals }");
  }
  
  return fields.join("\n");
}

async function fetchCompoundEvents(
  url: string,
  address: string,
  fromTimestamp: number,
  maxEvents?: number,
) {
  const schema = await getCompoundSchemaConfig(url);
  const selection = buildCompoundSelection(schema);
  const whereEntries: string[] = [];
  if (schema.whereAccountField) {
    whereEntries.push(`${schema.whereAccountField}: $user`);
  }
  if (schema.whereTimestampField) {
    whereEntries.push(`${schema.whereTimestampField}: $from`);
  }
  const whereClause = whereEntries.length
    ? `where: { ${whereEntries.join(", ")} }`
    : "";
  const orderByClause = schema.orderByField
    ? `orderBy: ${schema.orderByField}, orderDirection: asc`
    : "";
  const args = [whereClause, orderByClause, `first: ${PAGE_SIZE}`, `skip: $skip`]
    .filter(Boolean)
    .join(", ");

  const query = `
    query AccountEvents($user: String!, $from: Int!, $skip: Int!) {
      ${schema.queryField}(${args}) {
        ${selection}
      }
    }
  `;

  const events: NormalizedEvent[] = [];
  const limit = maxEvents && maxEvents > 0 ? maxEvents : null;
  let skip = 0;
  while (true) {
    const data = await postGraphQL<Record<string, Array<Record<string, unknown>> | undefined>>(
      url,
      query,
      {
      user: address,
      from: Math.max(0, Math.floor(fromTimestamp)),
      skip,
    });
    const batch = data[schema.queryField] ?? [];
    for (const raw of batch) {
      const asset =
        schema.assetField && raw[schema.assetField]
          ? ((raw[schema.assetField] as Record<string, unknown>) ?? null)
          : null;
      const txHashField = schema.fields.txHash;
      const txHash =
        (txHashField ? (raw[txHashField] as string | undefined) : undefined) ??
        ((raw.id as string | undefined) ?? "");
      const normalized = normalizeEvent({
        txHash,
        logIndex: schema.fields.logIndex
          ? (raw[schema.fields.logIndex] as number | string | undefined)
          : undefined,
        blockNumber: schema.fields.blockNumber
          ? (raw[schema.fields.blockNumber] as number | string | undefined)
          : undefined,
        timestamp: schema.fields.timestamp
          ? (raw[schema.fields.timestamp] as number | string | undefined)
          : undefined,
        eventType: schema.fields.eventType
          ? (raw[schema.fields.eventType] as string | undefined)
          : undefined,
        assetAddress: schema.assetFields?.id
          ? (asset?.[schema.assetFields.id] as string | undefined)
          : undefined,
        assetSymbol: schema.assetFields?.symbol
          ? (asset?.[schema.assetFields.symbol] as string | undefined)
          : undefined,
        assetDecimals: schema.assetFields?.decimals
          ? (asset?.[schema.assetFields.decimals] as number | string | undefined)
          : undefined,
        amountRaw: schema.fields.amount
          ? (raw[schema.fields.amount] as string | undefined)
          : undefined,
        amountUsdRaw: schema.fields.amountUsd
          ? (raw[schema.fields.amountUsd] as string | undefined)
          : undefined,
      });
      if (normalized) events.push(normalized);
      if (limit && events.length >= limit) {
        return events.slice(0, limit);
      }
    }
    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return events;
}

async function getCompoundSchemaConfig(url: string): Promise<CompoundSchemaConfig> {
  if (!compoundSchemaCache.has(url)) {
    compoundSchemaCache.set(url, resolveCompoundSchemaConfig(url));
  }
  return compoundSchemaCache.get(url)!;
}

async function resolveCompoundSchemaConfig(
  url: string,
): Promise<CompoundSchemaConfig> {
  const data = await postGraphQL<{
    __schema?: { queryType?: { fields?: QueryFieldInfo[] } };
  }>(
    url,
    `
      query SchemaInfo {
        __schema {
          queryType {
            fields {
              name
              type { kind name ofType { kind name ofType { kind name } } }
              args {
                name
                type { kind name ofType { kind name ofType { kind name } } }
              }
            }
          }
        }
      }
    `,
    {},
  );

  const fields = data.__schema?.queryType?.fields ?? [];
  const queryFieldName =
    pickField(fields, ["accountEvents", "events", "accountEvent", "event"]) ??
    fields.find((field) => field.name.toLowerCase().includes("event"))?.name ??
    "accountEvents";
  const queryField = fields.find((field) => field.name === queryFieldName);
  if (!queryField) {
    throw new Error("Compound subgraph has no event query field.");
  }

  const eventTypeName = unwrapTypeName(queryField.type);
  if (!eventTypeName) {
    throw new Error("Compound subgraph event type not found.");
  }

  const eventTypeInfo = await postGraphQL<{
    __type?: { fields?: Array<{ name: string; type: TypeRef }> };
  }>(
    url,
    `
      query EventType($name: String!) {
        __type(name: $name) {
          fields {
            name
            type { kind name ofType { kind name ofType { kind name } } }
          }
        }
      }
    `,
    { name: eventTypeName },
  );

  const eventFields = eventTypeInfo.__type?.fields ?? [];
  const timestampField = pickField(eventFields, [
    "timestamp",
    "blockTimestamp",
    "block_timestamp",
  ]);
  const txHashField = pickField(eventFields, [
    "transactionHash",
    "txHash",
    "hash",
  ]);
  const logIndexField = pickField(eventFields, ["logIndex", "log_index"]);
  const blockNumberField = pickField(eventFields, ["blockNumber", "block_number"]);
  const eventTypeField = pickField(eventFields, ["eventType", "type", "action"]);
  const amountField = pickField(eventFields, ["amount", "amountBeforeFee", "amountAfterFee"]);
  const amountUsdField = pickField(eventFields, [
    "amountUsd",
    "amountUSD",
    "amount_usd",
    "amountInUSD",
  ]);
  const assetField = pickField(eventFields, ["asset", "token"]);

  let assetFields: CompoundSchemaConfig["assetFields"];
  if (assetField) {
    const assetTypeName = unwrapTypeName(
      eventFields.find((field) => field.name === assetField)?.type,
    );
    if (assetTypeName) {
      const assetTypeInfo = await postGraphQL<{
        __type?: { fields?: Array<{ name: string }> };
      }>(
        url,
        `
          query AssetType($name: String!) {
            __type(name: $name) {
              fields { name }
            }
          }
        `,
        { name: assetTypeName },
      );
      const assetTypeFields = assetTypeInfo.__type?.fields ?? [];
      assetFields = {
        id: pickField(assetTypeFields, ["id", "tokenAddress", "address"]),
        symbol: pickField(assetTypeFields, ["symbol", "name"]),
        decimals: pickField(assetTypeFields, ["decimals"]),
      };
    }
  }

  const whereArg = queryField.args.find((arg) => arg.name === "where");
  const whereTypeName = whereArg ? unwrapTypeName(whereArg.type) : null;
  let whereAccountField: string | undefined;
  let whereTimestampField: string | undefined;
  if (whereTypeName) {
    const whereTypeInfo = await postGraphQL<{
      __type?: { inputFields?: Array<{ name: string }> };
    }>(
      url,
      `
        query WhereType($name: String!) {
          __type(name: $name) {
            inputFields { name }
          }
        }
      `,
      { name: whereTypeName },
    );
    const whereFields = whereTypeInfo.__type?.inputFields ?? [];
    whereAccountField = pickField(whereFields, [
      "account",
      "user",
      "account_",
      "user_",
    ]);
    whereTimestampField = pickField(whereFields, [
      "timestamp_gte",
      "blockTimestamp_gte",
      "timestamp_gt",
    ]);
  }

  return {
    queryField: queryField.name,
    eventTypeName,
    fields: {
      id: pickField(eventFields, ["id"]),
      timestamp: timestampField,
      txHash: txHashField,
      logIndex: logIndexField,
      blockNumber: blockNumberField,
      eventType: eventTypeField,
      amount: amountField,
      amountUsd: amountUsdField,
    },
    whereAccountField,
    whereTimestampField,
    orderByField: timestampField,
    assetField,
    assetFields,
  };
}

function buildCompoundSelection(schema: CompoundSchemaConfig) {
  const fields: string[] = [];
  if (schema.fields.id) fields.push(schema.fields.id);
  if (schema.fields.timestamp) fields.push(schema.fields.timestamp);
  if (schema.fields.eventType) fields.push(schema.fields.eventType);
  if (schema.fields.amount) fields.push(schema.fields.amount);
  if (schema.fields.amountUsd) fields.push(schema.fields.amountUsd);
  if (schema.fields.logIndex) fields.push(schema.fields.logIndex);
  if (schema.fields.blockNumber) fields.push(schema.fields.blockNumber);
  if (schema.fields.txHash) fields.push(schema.fields.txHash);
  if (schema.assetField) {
    const assetFields = [
      schema.assetFields?.id,
      schema.assetFields?.symbol,
      schema.assetFields?.decimals,
    ].filter(Boolean);
    if (assetFields.length > 0) {
      fields.push(
        `${schema.assetField} { ${assetFields.join(" ")} }`,
      );
    }
  }
  return fields.join("\n");
}
