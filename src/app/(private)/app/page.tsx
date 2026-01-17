"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isAddress } from "viem";

import { WalletCard } from "@/components/wallet-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallets } from "@/hooks/useWallets";
import { useAaveAccountData } from "@/hooks/useAave";
import { getTargetedRecommendations, riskState } from "@/lib/calculations";
import { formatNumber, formatUsd } from "@/lib/format";

export default function DashboardPage() {
  const { wallets, loading, addWallet, updateTargets, removeWallet } =
    useWallets();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [chain, setChain] = useState("polygon");
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [summary, setSummary] = useState<
    Record<
      string,
      {
        collateralUsd: number;
        debtUsd: number;
        hf: number;
        lt: number;
        name: string;
        chain: string;
        hfMin: number;
        hfMax: number;
      }
    >
  >({});
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historyDays, setHistoryDays] = useState("30");
  const lastNotifiedRef = useRef<Record<string, string>>({});
  const [webhookError, setWebhookError] = useState<string | null>(null);

  const onAddWallet = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const trimmed = address.trim();
    if (!isAddress(trimmed)) {
      setError("Address inválido.");
      return;
    }
    const { error, errorMessage } = await addWallet({
      address: trimmed,
      label,
      chain,
    });
    if (error) {
      setError(errorMessage ?? "Não foi possível adicionar a wallet.");
      return;
    }
    setAddress("");
    setLabel("");
    setDialogOpen(false);
  };

  const totals = useMemo(() => {
    const entries = Object.values(summary);
    const collateralUsd = entries.reduce(
      (acc, item) =>
        acc + (Number.isFinite(item.collateralUsd) ? item.collateralUsd : 0),
      0,
    );
    const debtUsd = entries.reduce(
      (acc, item) => acc + (Number.isFinite(item.debtUsd) ? item.debtUsd : 0),
      0,
    );
    const weightedCollateral = entries.reduce(
      (acc, item) =>
        acc +
        (Number.isFinite(item.collateralUsd) && Number.isFinite(item.lt)
          ? item.collateralUsd * (item.lt / 10000)
          : 0),
      0,
    );
    const hf = debtUsd > 0 ? weightedCollateral / debtUsd : Infinity;
    return { collateralUsd, debtUsd, hf };
  }, [summary]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError(null);
        const searchParams = new URLSearchParams({ days: historyDays });
        if (historyFilter !== "all") {
          searchParams.set("walletId", historyFilter);
        }
        const response = await fetch(
          `/api/history/snapshots?${searchParams.toString()}`,
        );
        if (!response.ok) {
          throw new Error("Falha ao carregar histórico.");
        }
        const payload = (await response.json()) as {
          snapshots: HistorySnapshot[];
        };
        if (active) {
          setHistory(payload.snapshots ?? []);
        }
      } catch (error) {
        if (active) {
          setHistoryError(
            error instanceof Error ? error.message : "Falha ao carregar histórico.",
          );
        }
      } finally {
        if (active) {
          setHistoryLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [historyDays, historyFilter]);

  useEffect(() => {
    const entries = Object.entries(summary);
    if (!entries.length) return;

    const triggerNotification = async () => {
      const nonOk = entries.filter(([, item]) => {
        const status = getStatus(item.hf, item.hfMin, item.hfMax);
        return status !== "OK";
      });
      if (!nonOk.length) return;

      const results = await Promise.all(
        nonOk.map(async ([walletId, item]) => {
          const status = getStatus(item.hf, item.hfMin, item.hfMax);
          const last = lastNotifiedRef.current[walletId];
          if (last === status) return;
          lastNotifiedRef.current[walletId] = status;
          const recommendations = getTargetedRecommendations({
            collateralUsd: item.collateralUsd,
            debtUsd: item.debtUsd,
            liquidationThresholdBps: item.lt,
            hfMin: item.hfMin,
            hfMax: item.hfMax,
          });
          const response = await fetch("/api/alerts/webhook", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              walletId,
              name: item.name,
              chain: item.chain,
              status,
              hf: item.hf,
              hfMin: item.hfMin,
              hfMax: item.hfMax,
              collateralUsd: item.collateralUsd,
              debtUsd: item.debtUsd,
              liquidationThresholdBps: item.lt,
              recommendations,
            }),
          });
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(
              body ? `Webhook erro: ${body}` : "Webhook erro: request falhou.",
            );
          }
        }),
      );
      if (results.length) {
        setWebhookError(null);
      }
    };

    triggerNotification().catch((error) => {
      setWebhookError(error instanceof Error ? error.message : "Webhook falhou.");
      console.error("webhook", error);
    });
  }, [summary]);


  const historySeries = useMemo(() => {
    if (!history.length) return [];
    const bucketMinutes = 15;
    const bucketMs = bucketMinutes * 60 * 1000;
    const buckets = new Map<number, Map<string, HistorySnapshot>>();

    for (const item of history) {
      const ts = new Date(item.captured_at).getTime();
      const bucket = Math.floor(ts / bucketMs) * bucketMs;
      const walletMap = buckets.get(bucket) ?? new Map<string, HistorySnapshot>();
      const existing = walletMap.get(item.wallet_id);
      if (!existing || existing.captured_at < item.captured_at) {
        walletMap.set(item.wallet_id, item);
      }
      buckets.set(bucket, walletMap);
    }

    return Array.from(buckets.entries())
      .map(([bucket, walletMap]) => {
        let collateralUsd = 0;
        let debtUsd = 0;
        let weightedCollateral = 0;
        for (const snapshot of walletMap.values()) {
          const collateral = Number(snapshot.total_collateral_usd ?? 0);
          const debt = Number(snapshot.total_debt_usd ?? 0);
          const lt = Number(snapshot.liquidation_threshold_bps ?? 0);
          collateralUsd += collateral;
          debtUsd += debt;
          weightedCollateral += collateral * (lt / 10000);
        }
        return {
          timestamp: bucket,
          collateralUsd,
          debtUsd,
          weightedCollateral,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((bucket) => ({
        timestamp: bucket.timestamp,
        collateralUsd: bucket.collateralUsd,
        debtUsd: bucket.debtUsd,
        hf:
          bucket.debtUsd > 0 ? bucket.weightedCollateral / bucket.debtUsd : 0,
      }));
  }, [history]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Monitoriza o Health Factor e recomendações por wallet.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Estratégias</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>Adicionar Estratégia</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar estratégia</DialogTitle>
            </DialogHeader>
            <form onSubmit={onAddWallet} className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="wallet-address">Address</Label>
                <Input
                  id="wallet-address"
                  placeholder="0x..."
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wallet-label">Nome da estratégia</Label>
                <Input
                  id="wallet-label"
                  placeholder="Ex: Bearmarket LINK"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Chain</Label>
                <Select value={chain} onValueChange={setChain}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleciona a chain" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="polygon">Polygon</SelectItem>
                    <SelectItem value="arbitrum">Arbitrum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit">Guardar estratégia</Button>
              {error ? (
                <p className="text-sm text-red-500">{error}</p>
              ) : null}
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resumo das estratégias</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-6 text-xs text-muted-foreground">
            <span>Estratégia</span>
            <span>Colateral</span>
            <span>Dívida</span>
            <span>HF</span>
            <span>Chain</span>
            <span>Status</span>
          </div>
          <div className="space-y-2">
            {wallets.map((wallet) => (
              <StrategySummaryRow
                key={wallet.id}
                walletId={wallet.id}
                address={wallet.address}
                name={wallet.label ?? "Sem nome"}
                chain={wallet.chain}
                onData={(data) =>
                  setSummary((prev) => {
                    const current = prev[wallet.id];
                    if (
                      current &&
                      current.collateralUsd === data.collateralUsd &&
                      current.debtUsd === data.debtUsd &&
                      current.hf === data.hf &&
                      current.lt === data.lt &&
                      current.name === data.name &&
                      current.chain === data.chain &&
                      current.hfMin === data.hfMin &&
                      current.hfMax === data.hfMax
                    ) {
                      return prev;
                    }
                    return { ...prev, [wallet.id]: data };
                  })
                }
                hfMin={wallet.wallet_hf_targets?.hf_min ?? 2.0}
                hfMax={wallet.wallet_hf_targets?.hf_max ?? 2.5}
              />
            ))}
          </div>
          <div className="border-t pt-3">
            <div className="grid grid-cols-6 text-sm font-semibold">
              <span>Total</span>
              <span>{formatUsd(totals.collateralUsd)}</span>
              <span>{formatUsd(totals.debtUsd)}</span>
              <span>
                {Number.isFinite(totals.hf) ? formatNumber(totals.hf, 2) : "-"}
              </span>
              <span>—</span>
              <span>—</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Histórico ({historyDays} dias)
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">
              Intervalo de tempo
            </Label>
            <Select value={historyDays} onValueChange={setHistoryDays}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="30 dias" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="365">365 dias</SelectItem>
                <SelectItem value="180">180 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="7">7 dias</SelectItem>
                <SelectItem value="1">1 dia</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Label className="text-xs text-muted-foreground">
            Filtrar por estratégia
          </Label>
          <Select value={historyFilter} onValueChange={setHistoryFilter}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue placeholder="Todas as estratégias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {wallets.map((wallet) => (
                <SelectItem key={wallet.id} value={wallet.id}>
                  {wallet.label ?? wallet.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {webhookError ? (
        <p className="text-sm text-red-500">{webhookError}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Health Factor total ({historyDays} dias)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {historyLoading ? <p>A carregar histórico...</p> : null}
            {historyError ? (
              <p className="text-sm text-red-500">{historyError}</p>
            ) : null}
            {!historyLoading && !historyError && !historySeries.length ? (
              <p className="text-sm text-muted-foreground">
                Sem dados suficientes para o gráfico.
              </p>
            ) : null}
            {historySeries.length ? (
              <LineChart
                data={historySeries}
                valueKey="hf"
                formatValue={(value) => formatNumber(value, 2)}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Colateral vs Dívida ({historyDays} dias)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {historyLoading ? <p>A carregar histórico...</p> : null}
            {historyError ? (
              <p className="text-sm text-red-500">{historyError}</p>
            ) : null}
            {!historyLoading && !historyError && !historySeries.length ? (
              <p className="text-sm text-muted-foreground">
                Sem dados suficientes para o gráfico.
              </p>
            ) : null}
            {historySeries.length ? (
              <MultiLineChart
                data={historySeries}
                lines={[
                  {
                    key: "collateralUsd",
                    label: "Colateral",
                    color: "text-emerald-500",
                    stroke: "#10b981",
                  },
                  {
                    key: "debtUsd",
                    label: "Dívida",
                    color: "text-rose-500",
                    stroke: "#f43f5e",
                  },
                ]}
                formatValue={(value) => formatUsd(value)}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {loading ? <p>A carregar wallets...</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {wallets.map((wallet) => (
          <WalletCard
            key={wallet.id}
            wallet={wallet}
            onUpdateTargets={updateTargets}
            onRemove={removeWallet}
          />
        ))}
      </div>
    </div>
  );
}

type HistorySnapshot = {
  wallet_id: string;
  chain: string;
  total_collateral_usd: number;
  total_debt_usd: number;
  health_factor: number;
  liquidation_threshold_bps: number;
  captured_at: string;
};

type AggregatedSnapshot = {
  timestamp: number;
  collateralUsd: number;
  debtUsd: number;
  weightedCollateral: number;
};

type HistoryPoint = {
  timestamp: number;
  collateralUsd: number;
  debtUsd: number;
  hf: number;
};

function LineChart({
  data,
  valueKey,
  formatValue,
}: {
  data: HistoryPoint[];
  valueKey: keyof HistoryPoint;
  formatValue: (value: number) => string;
}) {
  const values = data.map((item) => Number(item[valueKey] ?? 0));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
    const y = 40 - ((value - min) / range) * 36;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const lastValue = values[values.length - 1];
  const firstTs = data[0]?.timestamp;
  const midTs = data[Math.floor(data.length / 2)]?.timestamp;
  const lastTs = data[data.length - 1]?.timestamp;

  return (
    <div className="space-y-2">
      <svg viewBox="0 0 100 40" className="h-32 w-full">
        <polyline
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2"
          points={points.join(" ")}
        />
      </svg>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatAgeDays(firstTs, lastTs)}</span>
        <span>{formatAgeDays(midTs, lastTs)}</span>
        <span>Agora</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Último valor: {formatValue(lastValue)}
      </p>
    </div>
  );
}

function MultiLineChart({
  data,
  lines,
  formatValue,
}: {
  data: HistoryPoint[];
  lines: Array<{
    key: keyof HistoryPoint;
    label: string;
    color: string;
    stroke: string;
  }>;
  formatValue: (value: number) => string;
}) {
  const values = lines.flatMap((line) =>
    data.map((item) => Number(item[line.key] ?? 0)),
  );
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pointsByLine = lines.map((line) => {
    const series = data.map((item) => Number(item[line.key] ?? 0));
    const points = series.map((value, index) => {
      const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
      const y = 40 - ((value - min) / range) * 36;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return { line, points, lastValue: series[series.length - 1] ?? 0 };
  });
  const firstTs = data[0]?.timestamp;
  const midTs = data[Math.floor(data.length / 2)]?.timestamp;
  const lastTs = data[data.length - 1]?.timestamp;

  return (
    <div className="space-y-2">
      <svg viewBox="0 0 100 40" className="h-32 w-full">
        {pointsByLine.map(({ line, points }) => (
          <polyline
            key={line.key}
            fill="none"
            stroke={line.stroke}
            strokeWidth="2"
            points={points.join(" ")}
          />
        ))}
      </svg>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatAgeDays(firstTs, lastTs)}</span>
        <span>{formatAgeDays(midTs, lastTs)}</span>
        <span>Agora</span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {pointsByLine.map(({ line, lastValue }) => (
          <span key={line.key} className={line.color}>
            {line.label}: {formatValue(lastValue)}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatAgeDays(timestamp?: number, endTimestamp?: number) {
  if (!timestamp || !endTimestamp) return "—";
  const diffMs = Math.max(0, endTimestamp - timestamp);
  const days = Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
  return `${days}d`;
}

function getStatus(hf: number, hfMin: number, hfMax: number) {
  if (!Number.isFinite(hf)) return "OK";
  if (hf > hfMax) return "Acima do alvo";
  return riskState(hf, hfMin);
}

function StrategySummaryRow({
  walletId,
  address,
  name,
  chain,
  onData,
  hfMin,
  hfMax,
}: {
  walletId: string;
  address: string;
  name: string;
  chain: string;
  onData: (data: {
    collateralUsd: number;
    debtUsd: number;
    hf: number;
    lt: number;
    name: string;
    chain: string;
    hfMin: number;
    hfMax: number;
  }) => void;
  hfMin: number;
  hfMax: number;
}) {
  const { data } = useAaveAccountData(address, chain);
  const collateralUsd = data?.totalCollateralUsd ?? 0;
  const debtUsd = data?.totalDebtUsd ?? 0;
  const lt = data?.currentLiquidationThreshold ?? 0;
  const hf =
    debtUsd > 0 && lt > 0 ? (collateralUsd * (lt / 10000)) / debtUsd : Infinity;
  const status = useMemo(
    () => getStatus(hf, hfMin, hfMax),
    [hf, hfMax, hfMin],
  );
  const statusVariant =
    status === "Crítico"
      ? "destructive"
      : status === "Risco"
        ? "secondary"
        : status === "Acima do alvo"
          ? "outline"
          : "default";
  const statusClassName =
    status === "OK"
      ? "bg-emerald-600 text-white border-transparent"
      : status === "Risco"
        ? "bg-amber-500 text-white border-transparent"
        : status === "Acima do alvo"
          ? "bg-sky-500 text-white border-transparent"
          : "";
  const latestSnapshotRef = useRef({
    totalCollateralUsd: 0,
    totalDebtUsd: 0,
    healthFactor: 0,
    liquidationThresholdBps: 0,
  });

  useEffect(() => {
    onData({ collateralUsd, debtUsd, hf, lt, name, chain, hfMin, hfMax });
  }, [collateralUsd, debtUsd, hf, name, chain, hfMin, hfMax, onData, walletId]);

  useEffect(() => {
    if (!data) return;
    latestSnapshotRef.current = {
      totalCollateralUsd: Number(collateralUsd.toFixed(2)),
      totalDebtUsd: Number(debtUsd.toFixed(2)),
      healthFactor: Number.isFinite(hf) ? Number(hf.toFixed(4)) : 0,
      liquidationThresholdBps: lt,
    };
  }, [data, collateralUsd, debtUsd, hf, lt]);

  useEffect(() => {
    if (!data) return;
    const intervalMs = 15 * 60 * 1000;
    const sendSnapshot = () => {
      const payload = latestSnapshotRef.current;
      fetch("/api/history/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletId,
          chain,
          totalCollateralUsd: payload.totalCollateralUsd,
          totalDebtUsd: payload.totalDebtUsd,
          healthFactor: payload.healthFactor,
          liquidationThresholdBps: payload.liquidationThresholdBps,
        }),
      }).catch(() => null);
    };

    sendSnapshot();
    const id = setInterval(sendSnapshot, intervalMs);
    return () => clearInterval(id);
  }, [data, chain, walletId]);

  return (
    <div className="grid grid-cols-6 text-sm items-center">
      <span className="truncate">{name}</span>
      <span>{formatUsd(collateralUsd)}</span>
      <span>{formatUsd(debtUsd)}</span>
      <span>{Number.isFinite(hf) ? formatNumber(hf, 2) : "-"}</span>
      <span className="uppercase">{chain}</span>
      <span>
        <Badge variant={statusVariant} className={statusClassName}>
          {status}
        </Badge>
      </span>
    </div>
  );
}
