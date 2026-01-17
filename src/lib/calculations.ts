import { DEFAULT_HF_MAX, DEFAULT_HF_MIN } from "@/lib/constants";

export type RiskState = "OK" | "Risco" | "Crítico";

export function parseRayToNumber(value: bigint | number) {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return numeric / 1e27;
}

export function computeHealthFactor(
  collateralUsd: number,
  debtUsd: number,
  liquidationThresholdBps: number,
) {
  if (debtUsd <= 0) return Infinity;
  const lt = liquidationThresholdBps / 10000;
  return (collateralUsd * lt) / debtUsd;
}

export function riskState(hf: number, hfMin: number) {
  if (!Number.isFinite(hf)) return "OK";
  if (hf < 1) return "Crítico";
  if (hf < hfMin) return "Risco";
  return "OK";
}

export function getTargetedRecommendations(params: {
  collateralUsd: number;
  debtUsd: number;
  liquidationThresholdBps: number;
  hfMin?: number;
  hfMax?: number;
}) {
  const hfMin = params.hfMin ?? DEFAULT_HF_MIN;
  const hfMax = params.hfMax ?? DEFAULT_HF_MAX;
  const lt = params.liquidationThresholdBps / 10000;
  const hf = computeHealthFactor(
    params.collateralUsd,
    params.debtUsd,
    params.liquidationThresholdBps,
  );

  if (hf < hfMin) {
    const collateralTarget = (hfMin * params.debtUsd) / lt;
    const addCollateralUsd = Math.max(0, collateralTarget - params.collateralUsd);
    const debtTarget = (params.collateralUsd * lt) / hfMin;
    const repayDebtUsd = Math.max(0, params.debtUsd - debtTarget);

    return {
      hf,
      state: riskState(hf, hfMin),
      addCollateralUsd,
      repayDebtUsd,
    };
  }

  if (hf > hfMax) {
    const collateralTarget = (hfMax * params.debtUsd) / lt;
    const withdrawCollateralUsd = Math.max(
      0,
      params.collateralUsd - collateralTarget,
    );
    const debtTarget = (params.collateralUsd * lt) / hfMax;
    const additionalBorrowUsd = Math.max(0, debtTarget - params.debtUsd);

    return {
      hf,
      state: riskState(hf, hfMin),
      withdrawCollateralUsd,
      additionalBorrowUsd,
    };
  }

  return {
    hf,
    state: riskState(hf, hfMin),
  };
}

export function simulateHealthFactor(params: {
  collateralUsd: number;
  debtUsd: number;
  liquidationThresholdBps: number;
  debtAssetUsd: number;
  priceChangePct: number;
}) {
  const lt = params.liquidationThresholdBps / 10000;
  const multiplier = 1 + params.priceChangePct / 100;
  const simulatedDebt =
    params.debtUsd - params.debtAssetUsd + params.debtAssetUsd * multiplier;
  if (simulatedDebt <= 0) {
    return Infinity;
  }
  return (params.collateralUsd * lt) / simulatedDebt;
}

export function borrowToTargetWithReinvest(params: {
  collateralUsd: number;
  debtUsd: number;
  liquidationThresholdBps: number;
  targetHf: number;
}) {
  const lt = params.liquidationThresholdBps / 10000;
  const denominator = lt - params.targetHf;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) {
    return 0;
  }
  const numerator = params.targetHf * params.debtUsd - lt * params.collateralUsd;
  const result = numerator / denominator;
  return Math.max(0, result);
}
