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
  };
  whereUserField?: string;
  whereTimestampField?: string;
  directUserArg?: string;
  directTimestampArg?: string;
  orderByField?: string;
  reserveField?: string;
  reserveFields?: {
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
  const events: NormalizedEvent[] = [];
  const schemas = await getAaveSchemaConfig(url);
  for (const schema of schemas) {
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
        const reserve =
          schema.reserveField && raw[schema.reserveField]
            ? ((raw[schema.reserveField] as Record<string, unknown>) ?? null)
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
          eventType: schema.fields.action
            ? (raw[schema.fields.action] as string | undefined)
            : schema.fallbackEventType,
          assetAddress: schema.reserveFields?.underlyingAsset
            ? (reserve?.[schema.reserveFields.underlyingAsset] as string | undefined)
            : undefined,
          assetSymbol: schema.reserveFields?.symbol
            ? (reserve?.[schema.reserveFields.symbol] as string | undefined)
            : undefined,
          assetDecimals: schema.reserveFields?.decimals
            ? (reserve?.[schema.reserveFields.decimals] as number | string | undefined)
            : undefined,
          amountRaw: schema.fields.amount
            ? (raw[schema.fields.amount] as string | undefined)
            : undefined,
        });
        if (normalized) events.push(normalized);
      }
      if (batch.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
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

  if (configs.length > 0) {
    return configs;
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
  const supportedRequired = new Set(["user", "account", "from", "skip"]);
  if (requiredArgs.some((arg) => !supportedRequired.has(arg))) {
    return null;
  }

  const eventTypeName = unwrapTypeName(queryField.type);
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
    "amountUSD",
    "amountUsd",
    "value",
  ]);
  const reserveField = pickField(eventFields, ["reserve", "asset", "token"]);
  if (!timestampField) {
    return null;
  }

  let reserveFields: AaveSchemaConfig["reserveFields"];
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
      reserveFields = {
        symbol: pickField(reserveTypeFields, ["symbol", "name"]),
        underlyingAsset: pickField(reserveTypeFields, [
          "underlyingAsset",
          "underlyingAssetAddress",
          "tokenAddress",
          "id",
        ]),
        decimals: pickField(reserveTypeFields, ["decimals"]),
      };
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

  if (!whereUserField && !directUserArg) {
    return null;
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
    },
    whereUserField,
    whereTimestampField,
    directUserArg,
    directTimestampArg,
    orderByField: timestampField,
    reserveField,
    reserveFields,
    fallbackEventType: queryField.name,
  };
}

function buildAaveSelection(schema: AaveSchemaConfig) {
  const fields: string[] = [];
  if (schema.fields.id) fields.push(schema.fields.id);
  if (schema.fields.timestamp) fields.push(schema.fields.timestamp);
  if (schema.fields.action) fields.push(schema.fields.action);
  if (schema.fields.amount) fields.push(schema.fields.amount);
  if (schema.fields.logIndex) fields.push(schema.fields.logIndex);
  if (schema.fields.blockNumber) fields.push(schema.fields.blockNumber);
  if (schema.fields.txHash) fields.push(schema.fields.txHash);
  if (schema.reserveField) {
    const reserveFields = [
      schema.reserveFields?.symbol,
      schema.reserveFields?.underlyingAsset,
      schema.reserveFields?.decimals,
    ].filter(Boolean);
    if (reserveFields.length > 0) {
      fields.push(
        `${schema.reserveField} { ${reserveFields.join(" ")} }`,
      );
    }
  }
  return fields.join("\n");
}

async function fetchCompoundEvents(
  url: string,
  address: string,
  fromTimestamp: number,
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
      });
      if (normalized) events.push(normalized);
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
  const amountField = pickField(eventFields, ["amount", "amountUsd", "amountUSD"]);
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
