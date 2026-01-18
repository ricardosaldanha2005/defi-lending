"use client";

import useSWR from "swr";

import { Protocol } from "@/lib/protocols";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function buildUrl(
  protocol: Protocol,
  path: string,
  params: Record<string, string | undefined>,
) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return `/api/${protocol}/${path}?${query.toString()}`;
}

export function useProtocolAccountData(
  address?: string,
  chain: string = "polygon",
  protocol: Protocol = "aave",
) {
  const url = address
    ? buildUrl(protocol, "user-account-data", { address, chain })
    : null;
  return useSWR(url, fetcher, { refreshInterval: 30_000 });
}

export function useProtocolUserReserves(
  address?: string,
  chain: string = "polygon",
  protocol: Protocol = "aave",
) {
  const url = address
    ? buildUrl(protocol, "user-reserves", { address, chain })
    : null;
  return useSWR(url, fetcher, { refreshInterval: 60_000 });
}

export function useProtocolRates(
  chain: string = "polygon",
  protocol: Protocol = "aave",
) {
  const url = buildUrl(protocol, "rates", { chain });
  return useSWR(url, fetcher, { refreshInterval: 120_000 });
}
