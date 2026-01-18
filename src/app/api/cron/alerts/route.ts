import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { createClient } from "@supabase/supabase-js";

import { fetchUserAccountData } from "@/lib/aave/queries";
import { baseToUsd, DEFAULT_BASE_CURRENCY } from "@/lib/aave/normalize";
import { parseAaveChain } from "@/lib/aave/chains";
import { fetchCompoundAccountData } from "@/lib/compound/queries";
import { parseCompoundChain } from "@/lib/compound/chains";
import { getTargetedRecommendations, parseRayToNumber } from "@/lib/calculations";
import { DEFAULT_HF_MAX, DEFAULT_HF_MIN } from "@/lib/constants";
import { Protocol } from "@/lib/protocols";

type WalletRow = {
  id: string;
  user_id: string;
  address: string;
  label: string | null;
  chain: string;
  protocol: Protocol | null;
  wallet_hf_targets?: { hf_min: number; hf_max: number } | null;
};

type AlertItem = {
  walletId: string;
  userId: string;
  address: string;
  name: string;
  chain: string;
  protocol: Protocol;
  status: "OK" | "Risco" | "Crítico" | "Acima do alvo";
  hf: number;
  hfMin: number;
  hfMax: number;
  collateralUsd: number;
  debtUsd: number;
  liquidationThresholdBps: number;
  recommendations: ReturnType<typeof getTargetedRecommendations>;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(
      batch.map((item, idx) => mapper(item, i + idx)),
    );
    results.push(...batchResults);
  }
  return results;
}

const ABOVE_MAX_NOTIFY_PCT = Number(process.env.ALERTS_MAX_BUFFER_PCT ?? "0.1");

function getStatus(hf: number, hfMin: number, hfMax: number) {
  if (!Number.isFinite(hf)) return "OK";
  if (hf > hfMax) return "Acima do alvo";
  if (hf < 1) return "Crítico";
  if (hf < hfMin) return "Risco";
  return "OK";
}

function shouldNotify(status: AlertItem["status"], hf: number, hfMax: number) {
  if (status === "OK") return false;
  if (status !== "Acima do alvo") return true;
  const buffer = Number.isFinite(ABOVE_MAX_NOTIFY_PCT)
    ? Math.max(0, ABOVE_MAX_NOTIFY_PCT)
    : 0.1;
  return hf > hfMax * (1 + buffer);
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase service role configuration.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (!secret || secret !== process.env.ALERTS_POLL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("user_wallets")
      .select(
        "id,user_id,address,label,chain,protocol,wallet_hf_targets ( hf_min, hf_max )",
      );

    if (error) {
      console.error("cron.alerts.wallets", error);
      return NextResponse.json(
        { error: "Failed to load wallets" },
        { status: 500 },
      );
    }

    const wallets = (data ?? []).map((row) => {
      const target = Array.isArray(row.wallet_hf_targets)
        ? row.wallet_hf_targets[0]
        : row.wallet_hf_targets;
      return {
        ...row,
        wallet_hf_targets: target ?? null,
      };
    }) as WalletRow[];

    const results = await mapWithConcurrency(wallets, 3, async (wallet) => {
      if (!wallet.address || !isAddress(wallet.address)) {
        return null;
      }
      const hfMin = wallet.wallet_hf_targets?.hf_min ?? DEFAULT_HF_MIN;
      const hfMax = wallet.wallet_hf_targets?.hf_max ?? DEFAULT_HF_MAX;
      const protocol = (wallet.protocol ?? "aave") as Protocol;

      if (protocol === "compound") {
        const chain = parseCompoundChain(wallet.chain) ?? "arbitrum";
        const account = await fetchCompoundAccountData(
          wallet.address as `0x${string}`,
          chain,
        );
        const status = getStatus(account.healthFactorValue, hfMin, hfMax);
        if (!shouldNotify(status, account.healthFactorValue, hfMax)) return null;
        return {
          walletId: wallet.id,
          userId: wallet.user_id,
          address: wallet.address,
          name: wallet.label ?? wallet.address,
          chain,
          protocol,
          status,
          hf: account.healthFactorValue,
          hfMin,
          hfMax,
          collateralUsd: account.totalCollateralUsd,
          debtUsd: account.totalDebtUsd,
          liquidationThresholdBps: account.currentLiquidationThreshold,
          recommendations: getTargetedRecommendations({
            collateralUsd: account.totalCollateralUsd,
            debtUsd: account.totalDebtUsd,
            liquidationThresholdBps: account.currentLiquidationThreshold,
            hfMin,
            hfMax,
          }),
        } satisfies AlertItem;
      }

      const chain = parseAaveChain(wallet.chain) ?? "polygon";
      const accountData = await fetchUserAccountData(
        wallet.address as `0x${string}`,
        chain,
      );
      const [
        totalCollateralBase,
        totalDebtBase,
        _availableBorrowsBase,
        currentLiquidationThreshold,
        _ltv,
        healthFactor,
      ] = accountData;
      const baseCurrency = DEFAULT_BASE_CURRENCY;
      const collateralUsd = baseToUsd(totalCollateralBase, baseCurrency);
      const debtUsd = baseToUsd(totalDebtBase, baseCurrency);
      const ltBps = Number(currentLiquidationThreshold);
      const hfFromTotals =
        debtUsd > 0 && ltBps > 0
          ? (collateralUsd * (ltBps / 10000)) / debtUsd
          : Infinity;
      const hfValue = parseRayToNumber(healthFactor);
      const healthFactorValue =
        Number.isFinite(hfValue) && hfValue > 0.05 ? hfValue : hfFromTotals;

      const status = getStatus(healthFactorValue, hfMin, hfMax);
      if (!shouldNotify(status, healthFactorValue, hfMax)) return null;
      return {
        walletId: wallet.id,
        userId: wallet.user_id,
        address: wallet.address,
        name: wallet.label ?? wallet.address,
        chain,
        protocol,
        status,
        hf: healthFactorValue,
        hfMin,
        hfMax,
        collateralUsd,
        debtUsd,
        liquidationThresholdBps: ltBps,
        recommendations: getTargetedRecommendations({
          collateralUsd,
          debtUsd,
          liquidationThresholdBps: ltBps,
          hfMin,
          hfMax,
        }),
      } satisfies AlertItem;
    });

    const alerts = results.filter((item) => item !== null) as AlertItem[];

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      alerts,
    });
  } catch (error) {
    console.error("cron.alerts", error);
    return NextResponse.json(
      { error: "Failed to run alerts poll" },
      { status: 500 },
    );
  }
}
