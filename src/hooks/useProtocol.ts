"use client";

import useSWR from "swr";

import { Protocol } from "@/lib/protocols";

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;
  if (!response.ok) {
    const message =
      (data && typeof data === "object" && "error" in data && data.error) ||
      text ||
      "Request failed";
    throw new Error(typeof message === "string" ? message : "Request failed");
  }
  return data;
};

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

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
