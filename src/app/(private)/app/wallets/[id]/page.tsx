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

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">
          {wallet?.label ?? "Wallet"}{" "}
          <span className="text-sm text-muted-foreground">
            {wallet?.address} •{" "}
            {wallet ? PROTOCOL_LABELS[wallet.protocol] : "—"}
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
        </TabsList>

        <TabsContent value="resumo" className="space-y-4">
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
