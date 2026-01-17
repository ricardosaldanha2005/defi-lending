import { AAVE_CONFIG, AaveChain, DEFAULT_AAVE_CHAIN } from "@/lib/aave/addresses";
import { getPublicClient } from "@/lib/aave/client";

const protocolDataProviderAbi = [
  {
    type: "function",
    name: "getAllReservesTokens",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "symbol", type: "string" },
          { name: "tokenAddress", type: "address" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "unbacked", type: "uint256" },
      { name: "accruedToTreasuryScaled", type: "uint256" },
      { name: "totalAToken", type: "uint256" },
      { name: "totalStableDebt", type: "uint256" },
      { name: "totalVariableDebt", type: "uint256" },
      { name: "liquidityRate", type: "uint256" },
      { name: "variableBorrowRate", type: "uint256" },
      { name: "stableBorrowRate", type: "uint256" },
      { name: "averageStableBorrowRate", type: "uint256" },
      { name: "liquidityIndex", type: "uint256" },
      { name: "variableBorrowIndex", type: "uint256" },
      { name: "lastUpdateTimestamp", type: "uint40" },
    ],
  },
  {
    type: "function",
    name: "getReserveConfigurationData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "decimals", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "liquidationThreshold", type: "uint256" },
      { name: "liquidationBonus", type: "uint256" },
      { name: "reserveFactor", type: "uint256" },
      { name: "usageAsCollateralEnabled", type: "bool" },
      { name: "borrowingEnabled", type: "bool" },
      { name: "stableBorrowRateEnabled", type: "bool" },
      { name: "isActive", type: "bool" },
      { name: "isFrozen", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getReserveTokensAddresses",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "aTokenAddress", type: "address" },
      { name: "stableDebtTokenAddress", type: "address" },
      { name: "variableDebtTokenAddress", type: "address" },
    ],
  },
  {
    type: "function",
    name: "getUserReserveData",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "currentATokenBalance", type: "uint256" },
      { name: "currentStableDebt", type: "uint256" },
      { name: "currentVariableDebt", type: "uint256" },
      { name: "principalStableDebt", type: "uint256" },
      { name: "scaledVariableDebt", type: "uint256" },
      { name: "stableBorrowRate", type: "uint256" },
      { name: "liquidityRate", type: "uint256" },
      { name: "stableBorrowLastUpdateTimestamp", type: "uint40" },
      { name: "usageAsCollateralEnabled", type: "bool" },
    ],
  },
] as const;

const oracleAbi = [
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const DEFAULT_CONCURRENCY = 2;
const BATCH_DELAY_MS = 200;

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
    if (i + limit < items.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  return results;
}

export async function fetchProtocolReservesData(
  chain: AaveChain = DEFAULT_AAVE_CHAIN,
) {
  const client = getPublicClient(chain);
  const config = AAVE_CONFIG[chain];
  const reserves = await client.readContract({
    address: config.protocolDataProvider,
    abi: protocolDataProviderAbi,
    functionName: "getAllReservesTokens",
  });

  const asTuple = <T extends Record<string, unknown>>(
    value: T | unknown[],
  ) => (Array.isArray(value) ? value : value);
  const pick = (value: Record<string, unknown> | unknown[], key: string, idx: number) =>
    Array.isArray(value) ? value[idx] : value[key];

  const reserveList = Array.isArray(reserves)
    ? reserves
    : Object.values(reserves as Record<string, unknown>).filter(
        (value) =>
          Array.isArray(value) ||
          (value && typeof value === "object" && "tokenAddress" in value),
      );

  const mapped = await mapWithConcurrency(
    reserveList,
    DEFAULT_CONCURRENCY,
    async (entry) => {
      const symbol = pick(entry, "symbol", 0) as string;
      const underlyingAsset = pick(entry, "tokenAddress", 1) as `0x${string}`;
      const reserveData = await client.readContract({
        address: config.protocolDataProvider,
        abi: protocolDataProviderAbi,
        functionName: "getReserveData",
        args: [underlyingAsset],
      });
      const reserveConfigData = await client.readContract({
        address: config.protocolDataProvider,
        abi: protocolDataProviderAbi,
        functionName: "getReserveConfigurationData",
        args: [underlyingAsset],
      });
      const tokenAddresses = await client.readContract({
        address: config.protocolDataProvider,
        abi: protocolDataProviderAbi,
        functionName: "getReserveTokensAddresses",
        args: [underlyingAsset],
      });

      const reserve = asTuple(reserveData);
      const reserveConfig = asTuple(reserveConfigData);
      const tokens = asTuple(tokenAddresses);

      const totalAToken = pick(reserve, "totalAToken", 2) as bigint;
      const totalStableDebt = pick(reserve, "totalStableDebt", 3) as bigint;
      const totalVariableDebt = pick(reserve, "totalVariableDebt", 4) as bigint;
      const availableLiquidity =
        totalAToken > totalStableDebt + totalVariableDebt
          ? totalAToken - totalStableDebt - totalVariableDebt
          : 0n;

      return {
        underlyingAsset,
        name: symbol,
        symbol,
        decimals: pick(reserveConfig, "decimals", 0) as bigint,
        baseLTVasCollateral: pick(reserveConfig, "ltv", 1) as bigint,
        reserveLiquidationThreshold: pick(
          reserveConfig,
          "liquidationThreshold",
          2,
        ) as bigint,
        reserveLiquidationBonus: pick(
          reserveConfig,
          "liquidationBonus",
          3,
        ) as bigint,
        reserveFactor: pick(reserveConfig, "reserveFactor", 4) as bigint,
        usageAsCollateralEnabled: pick(
          reserveConfig,
          "usageAsCollateralEnabled",
          5,
        ) as boolean,
        borrowingEnabled: pick(reserveConfig, "borrowingEnabled", 6) as boolean,
        stableBorrowRateEnabled: pick(
          reserveConfig,
          "stableBorrowRateEnabled",
          7,
        ) as boolean,
        isActive: pick(reserveConfig, "isActive", 8) as boolean,
        isFrozen: pick(reserveConfig, "isFrozen", 9) as boolean,
        liquidityIndex: pick(reserve, "liquidityIndex", 9) as bigint,
        variableBorrowIndex: pick(reserve, "variableBorrowIndex", 10) as bigint,
        liquidityRate: pick(reserve, "liquidityRate", 5) as bigint,
        variableBorrowRate: pick(reserve, "variableBorrowRate", 6) as bigint,
        stableBorrowRate: pick(reserve, "stableBorrowRate", 7) as bigint,
        lastUpdateTimestamp: pick(
          reserve,
          "lastUpdateTimestamp",
          11,
        ) as bigint,
        aTokenAddress: pick(tokens, "aTokenAddress", 0) as `0x${string}`,
        stableDebtTokenAddress: pick(
          tokens,
          "stableDebtTokenAddress",
          1,
        ) as `0x${string}`,
        variableDebtTokenAddress: pick(
          tokens,
          "variableDebtTokenAddress",
          2,
        ) as `0x${string}`,
        availableLiquidity,
        priceInMarketReferenceCurrency: 0n,
      };
    },
  );

  return {
    reserves: mapped,
    baseCurrency: {
      marketReferenceCurrencyUnit: 100000000n,
      marketReferenceCurrencyPriceInUsd: 100000000n,
      networkBaseTokenPriceDecimals: 8,
    },
  };
}

export async function fetchAssetPrices(
  assets: `0x${string}`[],
  chain: AaveChain = DEFAULT_AAVE_CHAIN,
) {
  const client = getPublicClient(chain);
  const config = AAVE_CONFIG[chain];
  const uniqueAssets = Array.from(new Set(assets.map((a) => a.toLowerCase())));
  const entries = await mapWithConcurrency(
    uniqueAssets,
    DEFAULT_CONCURRENCY,
    async (asset) => {
      try {
        const price = await client.readContract({
          address: config.priceOracle,
          abi: oracleAbi,
          functionName: "getAssetPrice",
          args: [asset as `0x${string}`],
        });
        return [asset, price] as const;
      } catch (error) {
        console.warn("price-oracle", asset, error);
        return [asset, 0n] as const;
      }
    },
  );

  return new Map(entries);
}

export async function fetchProtocolUserReserves(
  user: `0x${string}`,
  reserves: { underlyingAsset: `0x${string}` }[],
  chain: AaveChain = DEFAULT_AAVE_CHAIN,
) {
  const client = getPublicClient(chain);
  const config = AAVE_CONFIG[chain];
  const userReserves = await mapWithConcurrency(
    reserves,
    DEFAULT_CONCURRENCY,
    async (reserve) => {
      const data = await client.readContract({
        address: config.protocolDataProvider,
        abi: protocolDataProviderAbi,
        functionName: "getUserReserveData",
        args: [reserve.underlyingAsset, user],
      });

      const pick = (
        value: Record<string, unknown> | unknown[],
        key: string,
        idx: number,
      ) => (Array.isArray(value) ? value[idx] : value[key]);

      return {
        underlyingAsset: reserve.underlyingAsset,
        scaledATokenBalance: pick(data, "currentATokenBalance", 0) as bigint,
        scaledVariableDebt: pick(data, "currentVariableDebt", 2) as bigint,
        principalStableDebt: pick(data, "currentStableDebt", 1) as bigint,
        usageAsCollateralEnabledOnUser: pick(
          data,
          "usageAsCollateralEnabled",
          8,
        ) as boolean,
        isScaled: false,
      };
    },
  );

  return { userReserves };
}
