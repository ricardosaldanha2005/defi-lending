import { formatUnits } from "viem";

import { getPublicClient } from "@/lib/aave/client";
import { withCache } from "@/lib/cache";
import { cometAbi, erc20Abi } from "@/lib/compound/cometAbi";
import {
  CompoundChain,
  DEFAULT_COMPOUND_CHAIN,
  getCometAddress,
} from "@/lib/compound/chains";

const PRICE_DECIMALS = 8;
const PRICE_SCALE = Number(BigInt(10) ** BigInt(PRICE_DECIMALS));
const MARKET_TTL = 5 * 60 * 1000;
const DEFAULT_CONCURRENCY = 2;
const BATCH_DELAY_MS = 200;

type CompoundAssetInfo = {
  asset: `0x${string}`;
  priceFeed: `0x${string}`;
  scale: bigint;
  borrowCollateralFactor: bigint;
  liquidateCollateralFactor: bigint;
  liquidationFactor: bigint;
};

type CompoundMarket = {
  baseToken: `0x${string}`;
  basePriceFeed: `0x${string}`;
  baseDecimals: number;
  baseSymbol: string;
  assets: CompoundAssetInfo[];
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
    if (i + limit < items.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  return results;
}

function scaleToDecimals(scale: bigint) {
  const digits = scale.toString().length;
  return Math.max(0, digits - 1);
}

async function fetchMarketData(chain: CompoundChain) {
  return withCache(`compound:market:${chain}`, MARKET_TTL, async () => {
    const comet = getCometAddress(chain);
    const client = getPublicClient(chain);

    const baseToken = await client.readContract({
      address: comet,
      abi: cometAbi,
      functionName: "baseToken",
    });
    const [basePriceFeed, baseDecimals, baseSymbol, assetCount] =
      await Promise.all([
        client.readContract({
          address: comet,
          abi: cometAbi,
          functionName: "baseTokenPriceFeed",
        }),
        client.readContract({
          address: baseToken,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        client.readContract({
          address: baseToken,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        client.readContract({
          address: comet,
          abi: cometAbi,
          functionName: "numAssets",
        }),
      ]);

    const count = Number(assetCount);
    const indices = Array.from({ length: count }, (_, i) => i);
    const assets = await mapWithConcurrency(
      indices,
      DEFAULT_CONCURRENCY,
      async (index) => {
        const info = await client.readContract({
          address: comet,
          abi: cometAbi,
          functionName: "getAssetInfo",
          args: [index],
        });
        return {
          asset: info.asset,
          priceFeed: info.priceFeed,
          scale: info.scale,
          borrowCollateralFactor: info.borrowCollateralFactor,
          liquidateCollateralFactor: info.liquidateCollateralFactor,
          liquidationFactor: info.liquidationFactor,
        } as CompoundAssetInfo;
      },
    );

    return {
      baseToken,
      basePriceFeed,
      baseDecimals: Number(baseDecimals),
      baseSymbol,
      assets,
    } as CompoundMarket;
  });
}

async function fetchPriceUsd(
  chain: CompoundChain,
  comet: `0x${string}`,
  priceFeed: `0x${string}`,
) {
  const client = getPublicClient(chain);
  try {
    const price = await client.readContract({
      address: comet,
      abi: cometAbi,
      functionName: "getPrice",
      args: [priceFeed],
    });
    return Number(price) / PRICE_SCALE;
  } catch {
    return 0;
  }
}

export async function fetchCompoundBaseAsset(
  chain: CompoundChain = DEFAULT_COMPOUND_CHAIN,
) {
  const comet = getCometAddress(chain);
  const market = await fetchMarketData(chain);
  const basePriceUsd = await fetchPriceUsd(chain, comet, market.basePriceFeed);
  return {
    symbol: market.baseSymbol,
    priceInUsd: basePriceUsd,
  };
}

export async function fetchCompoundUserReserves(
  address: `0x${string}`,
  chain: CompoundChain = DEFAULT_COMPOUND_CHAIN,
  debug = false,
) {
  const comet = getCometAddress(chain);
  const client = getPublicClient(chain);
  const market = await fetchMarketData(chain);

  const [borrowBalance, baseSupplyBalance] = await Promise.all([
    client.readContract({
      address: comet,
      abi: cometAbi,
      functionName: "borrowBalanceOf",
      args: [address],
    }),
    client.readContract({
      address: comet,
      abi: cometAbi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);
  const basePriceUsd = await fetchPriceUsd(chain, comet, market.basePriceFeed);

  const collateralBalances = await mapWithConcurrency(
    market.assets,
    DEFAULT_CONCURRENCY,
    async (asset) => {
      const balance = await client.readContract({
        address: comet,
        abi: cometAbi,
        functionName: "collateralBalanceOf",
        args: [address, asset.asset],
      });
      return { asset, balance };
    },
  );

  const collateralWithBalance = collateralBalances.filter(
    ({ balance }) => balance > BigInt(0),
  );

  const collateralSymbols = await mapWithConcurrency(
    collateralWithBalance,
    DEFAULT_CONCURRENCY,
    async ({ asset }) => {
      const symbol = await client.readContract({
        address: asset.asset,
        abi: erc20Abi,
        functionName: "symbol",
      });
      return symbol;
    },
  );

  const debugAssets = debug
    ? await mapWithConcurrency(market.assets, DEFAULT_CONCURRENCY, async (asset) => {
        const balanceEntry = collateralBalances.find(
          (entry) => entry.asset.asset === asset.asset,
        );
        const rawBalance = balanceEntry?.balance ?? BigInt(0);
        const symbol = await client.readContract({
          address: asset.asset,
          abi: erc20Abi,
          functionName: "symbol",
        });
        const decimals = scaleToDecimals(asset.scale);
        const amount = Number(formatUnits(rawBalance, decimals));
        const priceUsd = await fetchPriceUsd(chain, comet, asset.priceFeed);
        return {
          symbol,
          asset: asset.asset,
          priceFeed: asset.priceFeed,
          scale: asset.scale.toString(),
          balance: rawBalance.toString(),
          amount,
          priceUsd,
        };
      })
    : null;

  const collateralEntries = await Promise.all(
    collateralWithBalance.map(async ({ asset, balance }, index) => {
      const decimals = scaleToDecimals(asset.scale);
      const amount = Number(formatUnits(balance, decimals));
      const priceUsd = await fetchPriceUsd(chain, comet, asset.priceFeed);
      return {
        symbol: collateralSymbols[index] ?? "COLL",
        collateralAmount: amount,
        collateralUsd: amount * priceUsd,
        debtAmount: 0,
        debtUsd: 0,
        priceInUsd: priceUsd,
        liquidationFactor: asset.liquidationFactor,
        borrowCollateralFactor: asset.borrowCollateralFactor,
      };
    }),
  );

  const baseSupplyAmount = Number(
    formatUnits(baseSupplyBalance, market.baseDecimals),
  );
  const baseSupplyEntry =
    baseSupplyAmount > 0
      ? {
          symbol: market.baseSymbol,
          collateralAmount: baseSupplyAmount,
          collateralUsd: baseSupplyAmount * basePriceUsd,
          debtAmount: 0,
          debtUsd: 0,
          priceInUsd: basePriceUsd,
          liquidationFactor: BigInt(10) ** BigInt(18),
          borrowCollateralFactor: BigInt(10) ** BigInt(18),
        }
      : null;

  const debtAmount = Number(formatUnits(borrowBalance, market.baseDecimals));
  const debtEntry =
    debtAmount > 0
      ? {
          symbol: market.baseSymbol,
          collateralAmount: 0,
          collateralUsd: 0,
          debtAmount,
          debtUsd: debtAmount * basePriceUsd,
          priceInUsd: basePriceUsd,
        }
      : null;

  const reserves = [
    ...collateralEntries,
    ...(baseSupplyEntry ? [baseSupplyEntry] : []),
    ...(debtEntry ? [debtEntry] : []),
  ];

  return {
    reserves,
    comet,
    baseSymbol: market.baseSymbol,
    basePriceUsd,
    debug: debug
      ? {
          baseDecimals: market.baseDecimals,
          basePriceUsd,
          baseSupplyBalance: baseSupplyBalance.toString(),
          borrowBalance: borrowBalance.toString(),
          assets: debugAssets,
        }
      : null,
  };
}

export async function fetchCompoundAccountData(
  address: `0x${string}`,
  chain: CompoundChain = DEFAULT_COMPOUND_CHAIN,
) {
  const { reserves, baseSymbol, comet } = await fetchCompoundUserReserves(
    address,
    chain,
  );
  const collateralEntries = reserves.filter((entry) => entry.collateralAmount > 0);
  const totalCollateralUsd = collateralEntries.reduce(
    (acc, entry) => acc + (Number.isFinite(entry.collateralUsd) ? entry.collateralUsd : 0),
    0,
  );
  const totalDebtUsd = reserves.reduce(
    (acc, entry) => acc + (Number.isFinite(entry.debtUsd) ? entry.debtUsd : 0),
    0,
  );

  const weightedBorrowLimit = collateralEntries.reduce((acc, entry) => {
    const factor = "borrowCollateralFactor" in entry ? entry.borrowCollateralFactor : BigInt(0);
    const ratio = Number(factor) / 1e18;
    return acc + entry.collateralUsd * ratio;
  }, 0);

  const weightedLiquidation = collateralEntries.reduce((acc, entry) => {
    const factor = "liquidationFactor" in entry ? entry.liquidationFactor : BigInt(0);
    const ratio = Number(factor) / 1e18;
    return acc + entry.collateralUsd * ratio;
  }, 0);

  const availableBorrowsUsd = Math.max(0, weightedBorrowLimit - totalDebtUsd);
  const healthFactorValue =
    totalDebtUsd > 0 ? weightedLiquidation / totalDebtUsd : Infinity;
  const ltv =
    totalCollateralUsd > 0 ? (totalDebtUsd / totalCollateralUsd) * 10000 : 0;
  const currentLiquidationThreshold =
    totalCollateralUsd > 0
      ? (weightedLiquidation / totalCollateralUsd) * 10000
      : 0;

  return {
    totalCollateralUsd,
    totalDebtUsd,
    availableBorrowsUsd,
    currentLiquidationThreshold,
    ltv,
    healthFactorValue,
    market: {
      baseSymbol,
      comet,
    },
  };
}
