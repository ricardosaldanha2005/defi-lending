"use client";

import { useMemo } from "react";
import Link from "next/link";

import { WalletRow } from "@/hooks/useWallets";
import {
  useProtocolAccountData,
  useProtocolRates,
  useProtocolUserReserves,
} from "@/hooks/useProtocol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { formatNumber, formatToken, formatUsd } from "@/lib/format";
import { getTargetedRecommendations, riskState } from "@/lib/calculations";
import { DEFAULT_HF_MAX, DEFAULT_HF_MIN } from "@/lib/constants";
import { PROTOCOL_LABELS } from "@/lib/protocols";

type Props = {
  wallet: WalletRow;
  onUpdateTargets: (walletId: string, hfMin: number, hfMax: number) => void;
  onRemove: (walletId: string) => void;
};

export function WalletCard({ wallet, onUpdateTargets, onRemove }: Props) {
  const { data: accountData, error: accountError } = useProtocolAccountData(
    wallet.address,
    wallet.chain,
    wallet.protocol,
  );
  const { data: userReservesData, error: reservesError } =
    useProtocolUserReserves(
    wallet.address,
    wallet.chain,
    wallet.protocol,
  );
  const { data: ratesData, error: ratesError } = useProtocolRates(
    wallet.chain,
    wallet.protocol,
  );

  const hfMin = wallet.wallet_hf_targets?.hf_min ?? DEFAULT_HF_MIN;
  const hfMax = wallet.wallet_hf_targets?.hf_max ?? DEFAULT_HF_MAX;
  const totals = accountData
    ? {
        collateralUsd: accountData.totalCollateralUsd,
        debtUsd: accountData.totalDebtUsd,
        availableBorrowsUsd: accountData.availableBorrowsUsd,
        liquidationThreshold: accountData.currentLiquidationThreshold,
        healthFactor: accountData.healthFactorValue,
      }
    : null;

  const recommendations = totals
    ? getTargetedRecommendations({
        collateralUsd: totals.collateralUsd,
        debtUsd: totals.debtUsd,
        liquidationThresholdBps: totals.liquidationThreshold,
        hfMin,
        hfMax,
      })
    : null;

  const debtAsset = useMemo(() => {
    if (!userReservesData?.reserves) return null;
    return [...userReservesData.reserves]
      .filter((reserve) => reserve.debtAmount > 0)
      .sort((a, b) => b.debtAmount - a.debtAmount)[0];
  }, [userReservesData]);

  const recommendedBorrowAsset = useMemo(() => {
    if (!ratesData?.recommended || !ratesData?.candidates) return null;
    return ratesData.candidates.find(
      (candidate: { symbol: string }) => candidate.symbol === ratesData.recommended,
    );
  }, [ratesData]);

  const healthFactorValue =
    totals && totals.healthFactor > 0
      ? totals.healthFactor
      : totals
        ? (totals.debtUsd > 0
            ? (totals.collateralUsd * (totals.liquidationThreshold / 10000)) /
              totals.debtUsd
            : Infinity)
        : 0;
  const state = useMemo(() => {
    if (!totals) return "OK";
    if (Number.isFinite(healthFactorValue) && healthFactorValue > hfMax) {
      return "Acima do alvo";
    }
    return riskState(healthFactorValue, hfMin);
  }, [totals, healthFactorValue, hfMax, hfMin]);

  const badgeVariant =
    state === "Crítico"
      ? "destructive"
      : state === "Risco"
        ? "secondary"
        : state === "Acima do alvo"
          ? "outline"
          : "default";
  const badgeClassName =
    state === "OK"
      ? "bg-emerald-600 text-white border-transparent"
      : state === "Risco"
        ? "bg-amber-500 text-white border-transparent"
        : state === "Acima do alvo"
          ? "bg-sky-500 text-white border-transparent"
          : "";

  return (
    <Card className="border bg-card/80 shadow-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-semibold">
            {wallet.label ?? wallet.address}
          </CardTitle>
          <Badge
            variant={badgeVariant}
            className={`${badgeClassName} rounded-full px-2 py-0.5 text-xs`}
          >
            {state}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {wallet.address} • {PROTOCOL_LABELS[wallet.protocol]}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {accountError || reservesError || ratesError ? (
          <p className="text-xs text-red-500">
            Falha ao atualizar dados on-chain. Verifica o RPC e o contrato do
            protocolo.
          </p>
        ) : null}
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Health Factor</p>
            <p className="text-2xl font-semibold">
              {totals ? formatNumber(healthFactorValue, 2) : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Colateral (USD)</p>
            <p className="text-lg font-medium">
              {totals ? formatUsd(totals.collateralUsd) : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dívida (USD)</p>
            <p className="text-lg font-medium">
              {totals ? formatUsd(totals.debtUsd) : "-"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">
              Liquidation threshold
            </p>
            <p className="text-sm font-medium">
              {totals
                ? formatNumber(totals.liquidationThreshold / 100, 2) + "%"
                : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">LTV</p>
            <p className="text-sm font-medium">
              {accountData?.ltv !== undefined
                ? formatNumber(accountData.ltv / 100, 2) + "%"
                : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Borrow power</p>
            <p className="text-sm font-medium">
              {totals ? formatUsd(totals.availableBorrowsUsd) : "-"}
            </p>
          </div>
        </div>

        <Separator className="bg-border/60" />

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Intervalo alvo HF</p>
            <p className="text-sm font-medium">
              {hfMin} - {hfMax}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Recomendações</Label>
            <div className="space-y-2 text-sm text-muted-foreground">
              {!recommendations && <p>Sem dados on-chain.</p>}
              {recommendations?.addCollateralUsd ? (
                <p>
                  Add colateral: {formatUsd(recommendations.addCollateralUsd)} (
                  {formatToken(recommendations.addCollateralUsd, "USDT", 2)})
                </p>
              ) : null}
              {recommendations?.repayDebtUsd ? (
                <p>
                  Pagar dívida: {formatUsd(recommendations.repayDebtUsd)}
                  {debtAsset
                    ? debtAsset.priceInUsd > 0
                      ? ` (${formatToken(
                          recommendations.repayDebtUsd / debtAsset.priceInUsd,
                          debtAsset.symbol,
                          4,
                        )})`
                      : ""
                    : ""}
                </p>
              ) : null}
              {recommendations?.withdrawCollateralUsd ? (
                <p>
                  Retirar colateral:{" "}
                  {formatUsd(recommendations.withdrawCollateralUsd)} (
                  {formatToken(
                    recommendations.withdrawCollateralUsd,
                    "USDT",
                    2,
                  )}
                  )
                </p>
              ) : null}
              {recommendations?.additionalBorrowUsd ? (
                <p>
                  Borrow adicional: {formatUsd(recommendations.additionalBorrowUsd)}
                  {recommendedBorrowAsset
                    ? recommendedBorrowAsset.priceInUsd > 0
                      ? ` (${formatToken(
                          recommendations.additionalBorrowUsd /
                            recommendedBorrowAsset.priceInUsd,
                          recommendedBorrowAsset.symbol,
                          4,
                        )})`
                      : ""
                    : ""}
                </p>
              ) : null}
              {!recommendations?.addCollateralUsd &&
              !recommendations?.repayDebtUsd &&
              !recommendations?.withdrawCollateralUsd &&
              !recommendations?.additionalBorrowUsd ? (
                <p>HF dentro do intervalo alvo.</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end">
          <Button asChild>
            <Link href={`/app/wallets/${wallet.id}`}>Detalhe</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
