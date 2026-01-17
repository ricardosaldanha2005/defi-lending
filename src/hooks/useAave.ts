"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useAaveAccountData(address?: string, chain: string = "polygon") {
  return useSWR(
    address
      ? `/api/aave/user-account-data?address=${address}&chain=${chain}`
      : null,
    fetcher,
    { refreshInterval: 30_000 },
  );
}

export function useAaveUserReserves(address?: string, chain: string = "polygon") {
  return useSWR(
    address
      ? `/api/aave/user-reserves?address=${address}&chain=${chain}`
      : null,
    fetcher,
    { refreshInterval: 60_000 },
  );
}

export function useAaveRates(chain: string = "polygon") {
  return useSWR(`/api/aave/rates?chain=${chain}`, fetcher, {
    refreshInterval: 120_000,
  });
}

export function useAaveReserves(chain: string = "polygon") {
  return useSWR(`/api/aave/reserves?chain=${chain}`, fetcher, {
    refreshInterval: 120_000,
  });
}
