import {
  IPool_ABI,
  IPoolAddressesProvider_ABI,
} from "@bgd-labs/aave-address-book/abis";

import { AAVE_CONFIG, AaveChain, DEFAULT_AAVE_CHAIN } from "@/lib/aave/addresses";
import { getPublicClient } from "@/lib/aave/client";
import { withCache } from "@/lib/cache";
import {
  fetchProtocolReservesData,
  fetchProtocolUserReserves,
} from "@/lib/aave/protocolDataProvider";

const RESERVES_TTL = 60_000;
const USER_TTL = 20_000;

export async function getPoolAddress(chain: AaveChain = DEFAULT_AAVE_CHAIN) {
  const client = getPublicClient(chain);
  const config = AAVE_CONFIG[chain];
  return client.readContract({
    address: config.poolAddressesProvider,
    abi: IPoolAddressesProvider_ABI,
    functionName: "getPool",
  });
}

export async function getPriceOracle(chain: AaveChain = DEFAULT_AAVE_CHAIN) {
  const client = getPublicClient(chain);
  const config = AAVE_CONFIG[chain];
  return client.readContract({
    address: config.poolAddressesProvider,
    abi: IPoolAddressesProvider_ABI,
    functionName: "getPriceOracle",
  });
}

export async function fetchReservesData(chain: AaveChain = DEFAULT_AAVE_CHAIN) {
  return withCache(`aave:reserves:${chain}`, RESERVES_TTL, async () => {
    return fetchProtocolReservesData(chain);
  });
}

export async function fetchUserReservesData(
  address: `0x${string}`,
  chain: AaveChain = DEFAULT_AAVE_CHAIN,
) {
  return withCache(
    `aave:user-reserves:${chain}:${address}`,
    USER_TTL,
    async () => {
      const { reserves } = await fetchProtocolReservesData(chain);
      return fetchProtocolUserReserves(address, reserves, chain);
    },
  );
}

export async function fetchUserAccountData(
  address: `0x${string}`,
  chain: AaveChain = DEFAULT_AAVE_CHAIN,
) {
  return withCache(
    `aave:user-account:${chain}:${address}`,
    USER_TTL,
    async () => {
      const client = getPublicClient(chain);
      const poolAddress = await getPoolAddress(chain);
    return client.readContract({
      address: poolAddress,
      abi: IPool_ABI,
      functionName: "getUserAccountData",
      args: [address],
    });
    },
  );
}
