type PriceParams = {
  chain: string;
  tokenAddress: string;
  timestampSec: number;
};

const COINGECKO_BASE_URL =
  process.env.COINGECKO_BASE_URL ?? "https://api.coingecko.com/api/v3";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY ?? "";

const PLATFORM_BY_CHAIN: Record<string, string> = {
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
  base: "base",
};

const cache = new Map<string, number>();

function getPlatform(chain: string) {
  return PLATFORM_BY_CHAIN[chain] ?? null;
}

function toCacheKey(platform: string, address: string, bucket: number) {
  return `${platform}:${address.toLowerCase()}:${bucket}`;
}

function pickClosest(prices: Array<[number, number]>, targetMs: number) {
  if (!prices.length) return null;
  let closest = prices[0];
  let bestDiff = Math.abs(prices[0][0] - targetMs);
  for (const point of prices) {
    const diff = Math.abs(point[0] - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = point;
    }
  }
  return closest[1];
}

export async function fetchHistoricalTokenPriceUsd({
  chain,
  tokenAddress,
  timestampSec,
}: PriceParams): Promise<number | null> {
  const platform = getPlatform(chain);
  if (!platform) return null;

  const bucket = Math.floor(timestampSec / 3600);
  const cacheKey = toCacheKey(platform, tokenAddress, bucket);
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const from = Math.max(0, timestampSec - 3600);
  const to = timestampSec + 3600;
  const url = new URL(
    `${COINGECKO_BASE_URL}/coins/${platform}/contract/${tokenAddress}/market_chart/range`,
  );
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  if (COINGECKO_API_KEY) {
    url.searchParams.set("x_cg_pro_api_key", COINGECKO_API_KEY);
  }

  const response = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json().catch(() => null)) as
    | { prices?: Array<[number, number]> }
    | null;
  const prices = payload?.prices ?? [];
  const price = pickClosest(prices, timestampSec * 1000);
  if (!Number.isFinite(price ?? NaN)) {
    return null;
  }
  cache.set(cacheKey, Number(price));
  return Number(price);
}
