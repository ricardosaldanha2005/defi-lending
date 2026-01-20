"use client";

import { useMemo } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { useProtocolAccountData } from "@/hooks/useProtocol";
import { useWallets, type WalletRow } from "@/hooks/useWallets";
import { riskState } from "@/lib/calculations";
import { DEFAULT_HF_MAX, DEFAULT_HF_MIN } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { PROTOCOL_LABELS } from "@/lib/protocols";

function shortAddress(address: string) {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function StrategyRow({ wallet }: { wallet: WalletRow }) {
  const { data: accountData } = useProtocolAccountData(
    wallet.address,
    wallet.chain,
    wallet.protocol,
  );

  const hfMin = wallet.wallet_hf_targets?.hf_min ?? DEFAULT_HF_MIN;
  const hfMax = wallet.wallet_hf_targets?.hf_max ?? DEFAULT_HF_MAX;
  const totals = accountData
    ? {
        collateralUsd: accountData.totalCollateralUsd,
        debtUsd: accountData.totalDebtUsd,
        liquidationThreshold: accountData.currentLiquidationThreshold,
        healthFactor: accountData.healthFactorValue,
      }
    : null;

  const healthFactorValue =
    totals && totals.healthFactor > 0
      ? totals.healthFactor
      : totals
        ? totals.debtUsd > 0
          ? (totals.collateralUsd * (totals.liquidationThreshold / 10000)) /
            totals.debtUsd
          : Infinity
        : 0;

  const status = useMemo(() => {
    if (!totals) return "OK";
    if (Number.isFinite(healthFactorValue) && healthFactorValue > hfMax) {
      return "Acima do alvo";
    }
    return riskState(healthFactorValue, hfMin);
  }, [totals, healthFactorValue, hfMax, hfMin]);

  const badgeVariant =
    status === "Crítico"
      ? "destructive"
      : status === "Risco"
        ? "secondary"
        : status === "Acima do alvo"
          ? "outline"
          : "default";
  const badgeClassName =
    status === "OK"
      ? "bg-emerald-600 text-white border-transparent"
      : status === "Risco"
        ? "bg-amber-500 text-white border-transparent"
        : status === "Acima do alvo"
          ? "bg-sky-500 text-white border-transparent"
          : "";

  return (
    <Link
      href={`/app/wallets/${wallet.id}`}
      className="flex flex-col gap-3 rounded-2xl border bg-card/90 px-4 py-4 shadow-sm transition hover:border-primary/40"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {wallet.label ?? shortAddress(wallet.address)}
          </p>
          <p className="text-xs text-muted-foreground">
            {shortAddress(wallet.address)} • {wallet.chain} •{" "}
            {PROTOCOL_LABELS[wallet.protocol]}
          </p>
        </div>
        <Badge
          variant={badgeVariant}
          className={`${badgeClassName} rounded-full px-2 py-0.5 text-[11px]`}
        >
          {status}
        </Badge>
      </div>

      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Health Factor</p>
          <p className="text-2xl font-semibold">
            {totals ? formatNumber(healthFactorValue, 2) : "-"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Intervalo alvo</p>
          <p className="text-sm font-medium">
            {formatNumber(hfMin, 2)} - {formatNumber(hfMax, 2)}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function MobileView() {
  const { wallets, loading } = useWallets();

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              DeFi Risk Manager
            </p>
            <h1 className="text-2xl font-semibold">Estratégias</h1>
          </div>
          <Link
            href="/app"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Dashboard
          </Link>
        </header>

        {loading ? (
          <div className="rounded-2xl border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            A carregar estratégias...
          </div>
        ) : wallets.length === 0 ? (
          <div className="rounded-2xl border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            Sem estratégias registadas.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {wallets.map((wallet) => (
              <StrategyRow key={wallet.id} wallet={wallet} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
