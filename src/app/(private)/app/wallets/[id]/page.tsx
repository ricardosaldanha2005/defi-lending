"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  useProtocolAccountData,
  useProtocolRates,
  useProtocolUserReserves,
} from "@/hooks/useProtocol";
import { useWalletNotes } from "@/hooks/useWalletNotes";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { DEFAULT_HF_MAX, DEFAULT_HF_MIN } from "@/lib/constants";
import { formatNumber, formatToken, formatUsd } from "@/lib/format";
import {
  borrowToTargetWithReinvest,
  getTargetedRecommendations,
  simulateHealthFactor,
} from "@/lib/calculations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PROTOCOL_LABELS, Protocol } from "@/lib/protocols";
import useSWR from "swr";

type WalletDetail = {
  id: string;
  address: string;
  label: string | null;
  chain: string;
  protocol: Protocol;
  wallet_hf_targets?: { hf_min: number; hf_max: number } | null;
};

type ReserveSummary = {
  symbol: string;
  collateralAmount: number;
  collateralUsd: number;
  debtAmount: number;
  debtUsd: number;
  priceInUsd: number;
};

type HistoryEvent = {
  id: string;
  event_type: string;
  asset_symbol: string | null;
  amount: number | null;
  amount_usd: number | null;
  block_timestamp: string;
  tx_hash: string;
};

type PnlData = {
  walletId: string;
  totals: {
    supplyUsd: number;
    withdrawUsd: number;
    borrowUsd: number;
    repayUsd: number;
    liquidationUsd: number;
    otherUsd: number;
  };
  netCollateralFlow: number;
  netDebtFlow: number;
  debtPnl?: {
    borrowedUsd: number;
    currentValueUsd: number;
    pnl: number;
    perAsset?: Array<{ symbol: string; borrowedUsd: number; currentValueUsd: number; pnl: number }>;
  };
  markToMarket?: {
    pnl: number;
    currentCollateralValue: number;
    currentDebtValue: number;
    historicalCollateralCost: number;
    historicalDebtCost: number;
    netPositionValue: number;
    netHistoricalCost: number;
  };
};

function PnlCard({
  walletId,
  currentDebtUsd,
}: {
  walletId: string;
  currentDebtUsd?: number;
}) {
  const fetcher = (url: string) => fetch(url).then((r) => r.json());
  const { data, error, isLoading } = useSWR<PnlData>(
    `/api/history/pnl?walletId=${walletId}`,
    fetcher,
    { refreshInterval: 60000 },
  );

  // Verificar primeiro se temos dívida atual (mesmo sem dados do P&L)
  const hasCurrentDebt = (currentDebtUsd ?? 0) > 0;

  if (isLoading) {
    // Se temos dívida mas está a carregar, mostrar dívida atual
    if (hasCurrentDebt) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>P&L do Empréstimo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Valor atual do empréstimo (USD)</p>
                <p className="text-lg font-semibold">
                  {formatUsd(currentDebtUsd!)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                A carregar dados históricos...
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>P&L do Empréstimo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">A carregar...</p>
        </CardContent>
      </Card>
    );
  }

  // Se temos erro mas temos dívida atual, mostrar dívida mesmo assim
  if (error || !data) {
    if (hasCurrentDebt) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>P&L do Empréstimo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Valor atual do empréstimo (USD)</p>
                <p className="text-lg font-semibold">
                  {formatUsd(currentDebtUsd!)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {error
                  ? "Erro ao carregar dados históricos. Sincroniza os eventos para ver o P&L."
                  : "Sincroniza os eventos históricos para ver o valor do empréstimo e calcular o P&L."}
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>P&L do Empréstimo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {error
              ? "Erro ao carregar P&L. Sincroniza os eventos históricos primeiro."
              : "Nenhum dado disponível."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { debtPnl, netDebtFlow } = data;

  // Usar dívida atual como prioridade, depois debtPnl, depois netDebtFlow
  // Se currentDebtUsd está definido e > 0, usar sempre esse valor
  const currentDebtValue =
    currentDebtUsd && currentDebtUsd > 0
      ? currentDebtUsd
      : debtPnl?.currentValueUsd ?? netDebtFlow ?? 0;

  // Se não temos dívida, mostrar mensagem
  if (currentDebtValue <= 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>P&L do Empréstimo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Não tens empréstimos ativos.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sempre usar currentDebtValue (da prop) para o valor atual; recalcular P&L para ser consistente
  const borrowedUsd =
    debtPnl?.borrowedUsd ??
    (data.totals.borrowUsd > 0 ? data.totals.borrowUsd - data.totals.repayUsd : currentDebtValue);
  const finalDebtPnl = {
    borrowedUsd,
    currentValueUsd: currentDebtValue,
    pnl: borrowedUsd - currentDebtValue, // P&L = valor emprestado - valor atual (positivo = ganho)
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>P&L do Empréstimo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Valor do empréstimo (USD)</p>
            <p className="text-lg font-semibold">
              {formatUsd(finalDebtPnl.borrowedUsd)}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Valor atual do empréstimo (USD)</p>
            <p className="text-lg font-semibold">
              {formatUsd(finalDebtPnl.currentValueUsd)}
            </p>
          </div>
          {/* Debug: mostrar valores brutos */}
          {process.env.NODE_ENV === "development" && (
            <div className="text-xs text-muted-foreground">
              Debug: currentDebtUsd={currentDebtUsd?.toFixed(2)}, currentDebtValue={currentDebtValue.toFixed(2)}, borrowedUsd={finalDebtPnl.borrowedUsd.toFixed(2)}
            </div>
          )}
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">P&L</p>
              <p
                className={`text-2xl font-bold ${
                  finalDebtPnl.pnl >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatUsd(finalDebtPnl.pnl)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {finalDebtPnl.pnl > 0
                ? "Ganho: o empréstimo vale menos agora (moeda desvalorizou)"
                : finalDebtPnl.pnl < 0
                ? "Perda: o empréstimo vale mais agora (moeda valorizou)"
                : "Sem P&L: o valor atual é igual ao valor emprestado"}
            </p>
          </>
          {debtPnl?.perAsset && debtPnl.perAsset.length > 0 && (
            <>
              <Separator />
              <p className="text-sm font-medium">Por ativo</p>
              <ul className="space-y-2 text-sm">
                {debtPnl.perAsset.map((a) => (
                  <li key={a.symbol} className="flex justify-between items-center">
                    <span className="font-mono text-muted-foreground">{a.symbol}</span>
                    <span className={a.pnl >= 0 ? "text-green-600" : "text-red-600"}>
                      {formatUsd(a.pnl)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!debtPnl && (
            <p className="text-xs text-muted-foreground">
              Nota: Sincroniza os eventos históricos para calcular o P&L preciso.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryEventsTab({
  walletId,
  chain,
}: {
  walletId: string;
  chain?: string;
}) {
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("borrow_only");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const fetcher = (url: string) => fetch(url).then((r) => r.json());
  const { data, error, isLoading, mutate } = useSWR<{ events: HistoryEvent[] }>(
    `/api/history/events?walletId=${walletId}&limit=1000`,
    fetcher,
    { refreshInterval: 30000 },
  );

  const runSync = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const r = await fetch("/api/history/events/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId,
          reset: true,
          includePrices: true,
          maxEvents: 2000,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error || (j as { detail?: string }).detail || "Sincronização falhou");
      await mutate();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSyncing(false);
    }
  };

  const allEvents = data?.events || [];

  // #region agent log
  const borrowRelatedEventsForLog = allEvents.filter((e) => {
    const key = (e.event_type || "").toLowerCase();
    return key.includes("borrow") || key.includes("repay");
  });
  if (allEvents.length >= 0) {
    fetch("http://127.0.0.1:7242/ingest/f851284a-e320-4111-a6b3-990427dc7984", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "wallets/[id]/page.tsx:HistoryEventsTab",
        message: "Frontend events filter",
        data: {
          allCount: allEvents.length,
          borrowRelatedCount: borrowRelatedEventsForLog.length,
          eventTypesSample: allEvents.slice(0, 10).map((e) => e.event_type),
        },
        timestamp: Date.now(),
        sessionId: "debug-session",
        hypothesisId: "C",
      }),
    }).catch(() => {});
  }
  // #endregion

  // Só eventos de borrow/repay para esta aba (movimentos do empréstimo)
  const borrowRelatedEvents = useMemo(() => {
    return allEvents.filter((e) => {
      const key = e.event_type.toLowerCase();
      return key.includes("borrow") || key.includes("repay");
    });
  }, [allEvents]);

  // Assets que aparecem nos movimentos de borrow
  const assets = useMemo(() => {
    const assetSet = new Set<string>();
    borrowRelatedEvents.forEach((e) => {
      if (e.asset_symbol) assetSet.add(e.asset_symbol);
    });
    return Array.from(assetSet).sort();
  }, [borrowRelatedEvents]);

  // Filtro: por defeito só borrow (entradas e saídas); opcionalmente só borrow ou só repay
  const events = useMemo(() => {
    return borrowRelatedEvents.filter((e) => {
      if (eventTypeFilter === "all") return true;
      const key = e.event_type.toLowerCase();
      if (eventTypeFilter === "borrow_only")
        return key.includes("borrow") || key.includes("repay");
      if (eventTypeFilter === "borrow") return key.includes("borrow");
      if (eventTypeFilter === "repay") return key.includes("repay");
      if (assetFilter !== "all" && e.asset_symbol !== assetFilter) return false;
      return true;
    }).filter((e) => assetFilter === "all" || e.asset_symbol === assetFilter);
  }, [borrowRelatedEvents, eventTypeFilter, assetFilter]);

  const getEventTypeLabel = (type: string) => {
    const key = type.toLowerCase();
    if (key.includes("borrow")) return "Borrow";
    if (key.includes("repay")) return "Repay";
    if (key.includes("supply") || key.includes("deposit")) return "Deposit";
    if (key.includes("withdraw")) return "Withdraw";
    if (key.includes("liquidat")) return "Liquidation";
    return type;
  };

  const getEventTypeColor = (type: string) => {
    const key = type.toLowerCase();
    if (key.includes("borrow")) return "destructive";
    if (key.includes("repay")) return "default";
    if (key.includes("supply") || key.includes("deposit")) return "default";
    if (key.includes("withdraw")) return "secondary";
    if (key.includes("liquidat")) return "destructive";
    return "outline";
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          A carregar eventos...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          Erro ao carregar eventos.
        </CardContent>
      </Card>
    );
  }

  if (borrowRelatedEvents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Movimentos de borrow</CardTitle>
        </CardHeader>
        <CardContent className="py-8 space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum movimento de borrow/repay encontrado. Sincroniza os eventos históricos para esta carteira.
          </p>
          <Button
            onClick={runSync}
            disabled={isSyncing}
          >
            {isSyncing ? "A sincronizar…" : "Sincronizar eventos"}
          </Button>
          {syncError && (
            <p className="text-sm text-destructive">{syncError}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Movimentos de borrow ({events.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label htmlFor="event-type-filter">Tipo</Label>
            <Select
              value={eventTypeFilter}
              onValueChange={setEventTypeFilter}
            >
              <SelectTrigger id="event-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="borrow_only">Entradas e saídas (borrow + repay)</SelectItem>
                <SelectItem value="borrow">Só entradas (borrow)</SelectItem>
                <SelectItem value="repay">Só saídas (repay)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label htmlFor="asset-filter">Asset</Label>
            <Select value={assetFilter} onValueChange={setAssetFilter}>
              <SelectTrigger id="asset-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {assets.map((asset) => (
                  <SelectItem key={asset} value={asset}>
                    {asset}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="text-right">Valor (USD)</TableHead>
                <TableHead>TX</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-sm">
                    {new Date(event.block_timestamp).toLocaleDateString("pt-PT", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getEventTypeColor(event.event_type) as any}>
                      {getEventTypeLabel(event.event_type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {event.asset_symbol || "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {event.amount != null
                      ? formatToken(event.amount, event.asset_symbol || "", 4)
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {event.amount_usd != null ? formatUsd(event.amount_usd) : "-"}
                  </TableCell>
                  <TableCell>
                    {event.tx_hash && event.tx_hash !== "0x" ? (
                      <a
                        href={
                          chain === "arbitrum"
                            ? `https://arbiscan.io/tx/${event.tx_hash}`
                            : chain === "base"
                              ? `https://basescan.org/tx/${event.tx_hash}`
                              : `https://polygonscan.com/tx/${event.tx_hash}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:underline font-mono"
                      >
                        {event.tx_hash.slice(0, 10)}...
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WalletDetailPage() {
  const params = useParams();
  const walletId = params.id as string;
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [hfMinInput, setHfMinInput] = useState(DEFAULT_HF_MIN);
  const [hfMaxInput, setHfMaxInput] = useState(DEFAULT_HF_MAX);
  const [labelInput, setLabelInput] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: accountData } = useProtocolAccountData(
    wallet?.address,
    wallet?.chain ?? "polygon",
    wallet?.protocol ?? "aave",
  );
  const { data: userReservesData } = useProtocolUserReserves(
    wallet?.address,
    wallet?.chain ?? "polygon",
    wallet?.protocol ?? "aave",
  );
  const { data: ratesData } = useProtocolRates(
    wallet?.chain ?? "polygon",
    wallet?.protocol ?? "aave",
  );
  const { notes, setNotes, saveNotes } = useWalletNotes(walletId);

  const [selectedDebtAsset, setSelectedDebtAsset] = useState<string>("");
  const [priceChange, setPriceChange] = useState(0);

  useEffect(() => {
    const loadWallet = async () => {
      const { data } = await supabase
        .from("user_wallets")
        .select(
          "id,address,label,chain,protocol,wallet_hf_targets ( hf_min, hf_max )",
        )
        .eq("id", walletId)
        .maybeSingle();
      if (data) {
        const target = Array.isArray(data.wallet_hf_targets)
          ? data.wallet_hf_targets[0]
          : data.wallet_hf_targets;
        const hfMin = target ? Number(target.hf_min) : DEFAULT_HF_MIN;
        const hfMax = target ? Number(target.hf_max) : DEFAULT_HF_MAX;
        setWallet({
          ...data,
          wallet_hf_targets: target
            ? { hf_min: hfMin, hf_max: hfMax }
            : null,
          protocol: (data.protocol ?? "aave") as Protocol,
        });
        setLabelInput(data.label ?? "");
        setHfMinInput(hfMin);
        setHfMaxInput(hfMax);
      }
    };
    loadWallet();
  }, [supabase, walletId]);

  const reserves = useMemo(
    () => (userReservesData?.reserves ?? []) as ReserveSummary[],
    [userReservesData],
  );

  const collateralReserves = useMemo(
    () => reserves.filter((reserve) => reserve.collateralAmount > 0),
    [reserves],
  );

  const debtReserves = useMemo(
    () => reserves.filter((reserve) => reserve.debtAmount > 0),
    [reserves],
  );

  useEffect(() => {
    if (debtReserves.length > 0 && !selectedDebtAsset) {
      setSelectedDebtAsset(debtReserves[0].symbol);
    }
  }, [debtReserves, selectedDebtAsset]);

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
          ? (totals.collateralUsd *
              (totals.liquidationThreshold / 10000)) /
            totals.debtUsd
          : Infinity
        : 0;

  const recommendations = totals
    ? getTargetedRecommendations({
        collateralUsd: totals.collateralUsd,
        debtUsd: totals.debtUsd,
        liquidationThresholdBps: totals.liquidationThreshold,
        hfMin: hfMinInput,
        hfMax: hfMaxInput,
      })
    : null;

  const selectedDebt = debtReserves.find(
    (reserve) => reserve.symbol === selectedDebtAsset,
  );

  const simulatedDebtUsd = selectedDebt
    ? totals?.debtUsd -
      selectedDebt.debtUsd +
      selectedDebt.debtUsd * (1 + priceChange / 100)
    : totals?.debtUsd;

  const simulatedHf =
    totals && selectedDebt
      ? simulateHealthFactor({
          collateralUsd: totals.collateralUsd,
          debtUsd: totals.debtUsd,
          liquidationThresholdBps: totals.liquidationThreshold,
          debtAssetUsd: selectedDebt.debtUsd,
          priceChangePct: priceChange,
        })
      : null;

  const simulatedRecommendations =
    totals && simulatedDebtUsd !== undefined
      ? getTargetedRecommendations({
          collateralUsd: totals.collateralUsd,
          debtUsd: simulatedDebtUsd,
          liquidationThresholdBps: totals.liquidationThreshold,
          hfMin: hfMinInput,
          hfMax: hfMaxInput,
        })
      : null;

  const borrowToMax = totals
    ? borrowToTargetWithReinvest({
        collateralUsd: totals.collateralUsd,
        debtUsd: totals.debtUsd,
        liquidationThresholdBps: totals.liquidationThreshold,
        targetHf: hfMaxInput,
      })
    : 0;

  const onSaveTargets = async () => {
    if (!wallet) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("wallet_hf_targets")
      .upsert(
        {
          user_id: user.id,
          wallet_id: wallet.id,
          hf_min: hfMinInput,
          hf_max: hfMaxInput,
        },
        { onConflict: "wallet_id" },
      );
  };

  const onSaveLabel = async () => {
    if (!wallet) return;
    await supabase
      .from("user_wallets")
      .update({ label: labelInput })
      .eq("id", wallet.id);
    setWallet((prev) => (prev ? { ...prev, label: labelInput } : prev));
  };

  const onDeleteStrategy = async () => {
    if (!wallet) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setDeleteError("Precisas de estar autenticado.");
        return;
      }

      const deletions = await Promise.all([
        supabase
          .from("wallet_strategy_notes")
          .delete()
          .eq("wallet_id", wallet.id)
          .eq("user_id", user.id),
        supabase
          .from("wallet_hf_targets")
          .delete()
          .eq("wallet_id", wallet.id)
          .eq("user_id", user.id),
        supabase
          .from("strategy_snapshots")
          .delete()
          .eq("wallet_id", wallet.id)
          .eq("user_id", user.id),
      ]);

      const deletionError = deletions.find((result) => result.error)?.error;
      if (deletionError) {
        throw deletionError;
      }

      const { error } = await supabase
        .from("user_wallets")
        .delete()
        .eq("id", wallet.id)
        .eq("user_id", user.id);
      if (error) {
        throw error;
      }
      router.push("/app");
    } catch (error) {
      console.error("delete.strategy", error);
      setDeleteError("Não foi possível eliminar a estratégia.");
    } finally {
      setDeleting(false);
    }
  };

  const recommendedBorrow = ratesData?.recommended ?? "-";
  const marketLabel =
    wallet?.protocol === "compound" && accountData?.market?.baseSymbol
      ? ` • ${accountData.market.baseSymbol} market`
      : "";

  return (
    <div className="space-y-8">
      <div className="space-y-3 rounded-2xl border bg-card/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">
          {wallet?.label ?? "Wallet"}{" "}
          <span className="text-sm text-muted-foreground">
            {wallet?.address} •{" "}
            {wallet ? PROTOCOL_LABELS[wallet.protocol] : "—"}
            {marketLabel}
          </span>
        </h1>
        <div className="grid gap-2 md:grid-cols-[2fr_auto] md:items-end">
          <div className="space-y-2">
            <Label>Nome da estratégia</Label>
            <Input
              value={labelInput}
              onChange={(event) => setLabelInput(event.target.value)}
              placeholder="Ex: Bearmarket LINK"
            />
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button variant="secondary" onClick={onSaveLabel}>
              Guardar nome
            </Button>
            <Button
              onClick={onDeleteStrategy}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? "A eliminar..." : "Eliminar estratégia"}
            </Button>
          </div>
          {deleteError ? (
            <p className="text-sm text-red-500">{deleteError}</p>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Estratégia: Lending + Borrow (Bearmarket bias)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Health Factor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">HF atual</p>
              <p className="text-2xl font-semibold">
                {totals ? formatNumber(healthFactorValue, 2) : "-"}
              </p>
            </div>
            <Badge variant="outline">
              Alvo {hfMinInput} - {hfMaxInput}
            </Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>HF mínimo</Label>
              <Input
                type="number"
                step="0.1"
                value={hfMinInput}
                onChange={(event) => setHfMinInput(Number(event.target.value))}
              />
            </div>
            <div>
              <Label>HF máximo</Label>
              <Input
                type="number"
                step="0.1"
                value={hfMaxInput}
                onChange={(event) => setHfMaxInput(Number(event.target.value))}
              />
            </div>
            <div className="flex items-end">
              <Button variant="secondary" onClick={onSaveTargets}>
                Guardar intervalo
              </Button>
            </div>
          </div>
          <Separator />
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Colateral total</p>
              <p className="text-lg font-medium">
                {totals ? formatUsd(totals.collateralUsd) : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Dívida total</p>
              <p className="text-lg font-medium">
                {totals ? formatUsd(totals.debtUsd) : "-"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="resumo">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="dividas">Dívidas</TabsTrigger>
          <TabsTrigger value="colateral">Colateral</TabsTrigger>
          <TabsTrigger value="simulador">Simulador</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="space-y-4">
          <PnlCard
            walletId={walletId}
            currentDebtUsd={accountData?.totalDebtUsd ?? totals?.debtUsd}
          />
          <Card>
            <CardHeader>
              <CardTitle>Recomendações atuais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {recommendations?.addCollateralUsd ? (
                <p>
                  Add colateral: {formatUsd(recommendations.addCollateralUsd)} (
                  {formatToken(recommendations.addCollateralUsd, "USDT", 2)})
                </p>
              ) : null}
              {recommendations?.repayDebtUsd ? (
                <p>
                  Pagar dívida: {formatUsd(recommendations.repayDebtUsd)}
                  {selectedDebt
                    ? selectedDebt.priceInUsd > 0
                      ? ` (${formatToken(
                          recommendations.repayDebtUsd /
                            selectedDebt.priceInUsd,
                          selectedDebt.symbol,
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
                  Borrow adicional: {formatUsd(recommendations.additionalBorrowUsd)}{" "}
                  {recommendedBorrow !== "-" ? `(${recommendedBorrow})` : ""}
                </p>
              ) : null}
              {!recommendations?.addCollateralUsd &&
              !recommendations?.repayDebtUsd &&
              !recommendations?.withdrawCollateralUsd &&
              !recommendations?.additionalBorrowUsd ? (
                <p>HF dentro do intervalo alvo.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Melhor altcoin para borrow</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Recomendado:{" "}
                <span className="font-semibold text-foreground">
                  {recommendedBorrow}
                </span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comparação de taxas</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Borrow APR</TableHead>
                    <TableHead>Liquidity APR</TableHead>
                    <TableHead>Disponível</TableHead>
                    <TableHead>Recomendado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ratesData?.candidates?.map(
                    (candidate: {
                      symbol: string;
                      variableBorrowApr: number;
                      liquidityApr: number;
                      borrowingEnabled: boolean;
                      isActive: boolean;
                      isFrozen: boolean;
                      available: boolean;
                    }) => (
                      <TableRow key={candidate.symbol}>
                        <TableCell>{candidate.symbol}</TableCell>
                        <TableCell>{formatNumber(candidate.variableBorrowApr, 2)}%</TableCell>
                        <TableCell>{formatNumber(candidate.liquidityApr, 2)}%</TableCell>
                        <TableCell>
                          {candidate.available ? "Sim" : "Não"}
                        </TableCell>
                        <TableCell>
                          {candidate.symbol === recommendedBorrow ? (
                            <Badge>Recomendado</Badge>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dividas">
          <Card>
            <CardHeader>
              <CardTitle>Breakdown de dívidas</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Dívida</TableHead>
                    <TableHead>USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {debtReserves.map((reserve) => (
                    <TableRow key={reserve.symbol}>
                      <TableCell>{reserve.symbol}</TableCell>
                      <TableCell>
                        {formatToken(reserve.debtAmount, reserve.symbol, 4)}
                      </TableCell>
                      <TableCell>
                        {reserve.debtUsd > 0 ? formatUsd(reserve.debtUsd) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="colateral">
          <Card>
            <CardHeader>
              <CardTitle>Breakdown de colateral</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Colateral</TableHead>
                    <TableHead>USD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collateralReserves.map((reserve) => (
                    <TableRow key={reserve.symbol}>
                      <TableCell>{reserve.symbol}</TableCell>
                      <TableCell>
                        {formatToken(
                          reserve.collateralAmount,
                          reserve.symbol,
                          4,
                        )}
                      </TableCell>
                      <TableCell>
                        {reserve.collateralUsd > 0
                          ? formatUsd(reserve.collateralUsd)
                          : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="simulador">
          <Card>
            <CardHeader>
              <CardTitle>Simulador “E se…”</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Altcoin alvo</Label>
                  <Select
                    value={selectedDebtAsset}
                    onValueChange={setSelectedDebtAsset}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleciona a dívida" />
                    </SelectTrigger>
                    <SelectContent>
                      {debtReserves.map((reserve) => (
                        <SelectItem key={reserve.symbol} value={reserve.symbol}>
                          {reserve.symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Variação de preço</Label>
                  <div className="flex items-center gap-4">
                    <Slider
                      value={[priceChange]}
                      onValueChange={(values) => setPriceChange(values[0])}
                      min={-60}
                      max={60}
                      step={5}
                    />
                    <span className="w-16 text-right text-sm">
                      {priceChange}%
                    </span>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">HF simulado</p>
                  <p className="text-2xl font-semibold">
                    {simulatedHf ? formatNumber(simulatedHf, 2) : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Dívida simulada</p>
                  <p className="text-lg font-medium">
                    {simulatedDebtUsd ? formatUsd(simulatedDebtUsd) : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Recomendações</p>
                  <p className="text-sm text-muted-foreground">
                    {simulatedRecommendations?.addCollateralUsd
                      ? `Add ${formatUsd(
                          simulatedRecommendations.addCollateralUsd,
                        )}`
                      : simulatedRecommendations?.repayDebtUsd
                        ? `Repay ${formatUsd(
                            simulatedRecommendations.repayDebtUsd,
                          )}`
                        : simulatedRecommendations?.withdrawCollateralUsd
                          ? `Withdraw ${formatUsd(
                              simulatedRecommendations.withdrawCollateralUsd,
                            )}`
                          : simulatedRecommendations?.additionalBorrowUsd
                            ? `Borrow ${formatUsd(
                                simulatedRecommendations.additionalBorrowUsd,
                              )}`
                            : "HF dentro do intervalo"}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Borrow para atingir HF máximo (vende + adiciona colateral)
                  </p>
                  <p className="text-lg font-medium">
                    {borrowToMax > 0 ? formatUsd(borrowToMax) : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Em unidades do asset selecionado
                  </p>
                  <p className="text-lg font-medium">
                    {borrowToMax > 0 &&
                    selectedDebt &&
                    typeof selectedDebt.priceInUsd === "number" &&
                    selectedDebt.priceInUsd > 0
                      ? formatToken(
                          borrowToMax / selectedDebt.priceInUsd,
                          selectedDebt.symbol,
                          4,
                        )
                      : "-"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="historico" className="space-y-4">
          <HistoryEventsTab walletId={walletId} chain={wallet?.chain} />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Notas da estratégia</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notas sobre esta estratégia..."
            rows={5}
          />
          <Button variant="secondary" onClick={() => saveNotes(notes)}>
            Guardar notas
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
