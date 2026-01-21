import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Protocol } from "@/lib/protocols";
import { fetchUserReservesData, fetchReservesData } from "@/lib/aave/queries";
import { fetchAssetPrices } from "@/lib/aave/protocolDataProvider";
import { parseAaveChain } from "@/lib/aave/chains";
import { applyIndex, toUsd } from "@/lib/aave/math";
import { formatUnits } from "viem";
import { fetchCompoundUserReserves } from "@/lib/compound/queries";
import { parseCompoundChain } from "@/lib/compound/chains";

type PnlRow = {
  event_type: string;
  amount_usd: number | null;
  asset_address: string | null;
  asset_symbol: string | null;
  amount: number | null;
  price_usd: number | null;
};

type AssetPosition = {
  address: string;
  symbol: string;
  collateralAmount: number;
  collateralUsd: number;
  debtAmount: number;
  debtUsd: number;
  priceInUsd: number;
};

function classifyEvent(type: string) {
  const key = type.toLowerCase();
  if (key.includes("borrow")) return "borrow";
  if (key.includes("repay")) return "repay";
  if (key.includes("supply") || key.includes("deposit")) return "supply";
  if (key.includes("withdraw")) return "withdraw";
  if (key.includes("liquidat")) return "liquidation";
  return "other";
}

async function fetchCurrentPosition(
  address: string,
  chain: string,
  protocol: Protocol,
): Promise<AssetPosition[]> {
  try {
    if (!isAddress(address)) {
      console.warn("Invalid address", address);
      return [];
    }

    if (protocol === "compound") {
      const compoundChain = parseCompoundChain(chain) ?? "arbitrum";
      const { reserves } = await fetchCompoundUserReserves(
        address as `0x${string}`,
        compoundChain,
        false,
      );
      // For Compound, we don't have asset address in reserves
      // We'll use symbol as a fallback identifier
      return reserves.map((r) => ({
        address: r.symbol?.toLowerCase() || "", // Use symbol as fallback since Compound doesn't provide asset address
        symbol: r.symbol || "",
        collateralAmount: r.collateralAmount || 0,
        collateralUsd: r.collateralUsd || 0,
        debtAmount: r.debtAmount || 0,
        debtUsd: r.debtUsd || 0,
        priceInUsd: r.priceInUsd || 0,
      }));
    } else {
      // Aave
      const aaveChain = parseAaveChain(chain) ?? "polygon";
      const [reservesData, userReservesData] = await Promise.all([
        fetchReservesData(aaveChain),
        fetchUserReservesData(address as `0x${string}`, aaveChain),
      ]);

      const { reserves, baseCurrency } = reservesData;
      const { userReserves } = userReservesData;

      const reserveMap = new Map(
        reserves.map((reserve) => [
          reserve.underlyingAsset.toLowerCase(),
          reserve,
        ]),
      );

      const assetAddresses = Array.from(
        new Set(reserves.map((r) => r.underlyingAsset as `0x${string}`)),
      );
      const priceMap = await fetchAssetPrices(assetAddresses, aaveChain);

      return userReserves
        .filter((ur) => {
          const reserve = reserveMap.get(ur.underlyingAsset.toLowerCase());
          if (!reserve) return false;
          const aTokenBalance = BigInt(ur.scaledATokenBalance || "0");
          const variableDebt = BigInt(ur.scaledVariableDebt || "0");
          const stableDebt = BigInt(ur.principalStableDebt || "0");
          return aTokenBalance > 0 || variableDebt > 0 || stableDebt > 0;
        })
        .map((ur) => {
          const reserve = reserveMap.get(ur.underlyingAsset.toLowerCase())!;
          const asset = {
            symbol: reserve.symbol,
            decimals: Number(reserve.decimals),
          };

          const aTokenBalance = applyIndex(
            BigInt(ur.scaledATokenBalance || "0"),
            BigInt(reserve.liquidityIndex || "0"),
          );
          const variableDebt = applyIndex(
            BigInt(ur.scaledVariableDebt || "0"),
            BigInt(reserve.variableBorrowIndex || "0"),
          );
          const stableDebt = BigInt(ur.principalStableDebt || "0");
          const totalDebt = variableDebt + stableDebt;

          const collateralAmount = Number(
            formatUnits(aTokenBalance, Number(asset.decimals)),
          );
          const debtAmount = Number(
            formatUnits(totalDebt, Number(asset.decimals)),
          );

          const priceInMarketReferenceCurrency =
            priceMap.get(reserve.underlyingAsset.toLowerCase()) ?? BigInt(0);

          const collateralUsd = toUsd({
            amount: aTokenBalance,
            decimals: Number(asset.decimals),
            priceInMarketReferenceCurrency,
            marketReferenceCurrencyUnit: baseCurrency.marketReferenceCurrencyUnit,
            marketReferenceCurrencyPriceInUsd:
              baseCurrency.marketReferenceCurrencyPriceInUsd,
            priceDecimals: baseCurrency.networkBaseTokenPriceDecimals,
          });

          const debtUsd = toUsd({
            amount: totalDebt,
            decimals: Number(asset.decimals),
            priceInMarketReferenceCurrency,
            marketReferenceCurrencyUnit: baseCurrency.marketReferenceCurrencyUnit,
            marketReferenceCurrencyPriceInUsd:
              baseCurrency.marketReferenceCurrencyPriceInUsd,
            priceDecimals: baseCurrency.networkBaseTokenPriceDecimals,
          });

          const priceInUsd = toUsd({
            amount: BigInt(10 ** Number(asset.decimals)),
            decimals: Number(asset.decimals),
            priceInMarketReferenceCurrency,
            marketReferenceCurrencyUnit: baseCurrency.marketReferenceCurrencyUnit,
            marketReferenceCurrencyPriceInUsd:
              baseCurrency.marketReferenceCurrencyPriceInUsd,
            priceDecimals: baseCurrency.networkBaseTokenPriceDecimals,
          });

          return {
            address: reserve.underlyingAsset.toLowerCase(),
            symbol: asset.symbol,
            collateralAmount,
            collateralUsd,
            debtAmount,
            debtUsd,
            priceInUsd,
          };
        });
    }
  } catch (error) {
    console.error("Failed to fetch current position", error);
    return [];
  }
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const walletId = searchParams.get("walletId");
  if (!walletId) {
    return NextResponse.json({ error: "walletId required" }, { status: 400 });
  }

  // Fetch wallet info
  const { data: wallet, error: walletError } = await supabase
    .from("user_wallets")
    .select("address,chain,protocol")
    .eq("id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (walletError || !wallet) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // Fetch events with asset details for mark-to-market calculation
  // IMPORTANTE: Não filtrar por amount_usd null, porque precisamos de contar todos os eventos
  // Mesmo sem amount_usd, podemos calcular usando amount * price_usd se disponível
  let query = supabase
    .from("strategy_events")
    .select(
      "event_type,amount_usd,asset_address,asset_symbol,amount,price_usd",
    )
    .eq("user_id", user.id)
    .eq("wallet_id", walletId);

  if (from) {
    query = query.gte("block_timestamp", from);
  }
  if (to) {
    query = query.lte("block_timestamp", to);
  }

  const { data, error } = await query;

  if (error) {
    console.error("history.pnl", error);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }

  const totals = {
    supplyUsd: 0,
    withdrawUsd: 0,
    borrowUsd: 0,
    repayUsd: 0,
    liquidationUsd: 0,
    otherUsd: 0,
  };

  // Track cost basis by asset (for mark-to-market)
  type AssetCostBasis = {
    collateralCost: number; // Total USD cost of collateral
    collateralAmount: number; // Total amount of collateral
    debtCost: number; // Total USD cost of debt
    debtAmount: number; // Total amount of debt
  };
  const assetCostBasis = new Map<string, AssetCostBasis>();

  (data as PnlRow[] | null | undefined)?.forEach((row) => {
    // Calcular amount_usd se não estiver disponível, usando amount * price_usd
    let amountUsd = Number(row.amount_usd ?? 0);
    if (!Number.isFinite(amountUsd) || amountUsd === 0) {
      const amount = Number(row.amount ?? 0);
      const priceUsd = Number(row.price_usd ?? 0);
      if (Number.isFinite(amount) && Number.isFinite(priceUsd) && priceUsd > 0) {
        amountUsd = amount * priceUsd;
      }
    }
    if (!Number.isFinite(amountUsd) || amountUsd === 0) return;
    const kind = classifyEvent(row.event_type ?? "");

    // Update totals
    if (kind === "supply") totals.supplyUsd += amountUsd;
    else if (kind === "withdraw") totals.withdrawUsd += amountUsd;
    else if (kind === "borrow") totals.borrowUsd += amountUsd;
    else if (kind === "repay") totals.repayUsd += amountUsd;
    else if (kind === "liquidation") totals.liquidationUsd += amountUsd;
    else totals.otherUsd += amountUsd;

    // Track cost basis for mark-to-market
    const assetAddress = row.asset_address?.toLowerCase();
    if (assetAddress && row.amount && row.price_usd) {
      const amount = Number(row.amount);
      const priceUsd = Number(row.price_usd);
      if (Number.isFinite(amount) && Number.isFinite(priceUsd) && priceUsd > 0) {
        if (!assetCostBasis.has(assetAddress)) {
          assetCostBasis.set(assetAddress, {
            collateralCost: 0,
            collateralAmount: 0,
            debtCost: 0,
            debtAmount: 0,
          });
        }
        const basis = assetCostBasis.get(assetAddress)!;

        if (kind === "supply") {
          // Add to collateral cost basis (weighted average)
          basis.collateralCost += amountUsd;
          basis.collateralAmount += amount;
        } else if (kind === "withdraw") {
          // Remove from collateral proportionally (average cost method)
          if (basis.collateralAmount > 0) {
            const ratio = Math.min(1, amount / basis.collateralAmount);
            const costRemoved = basis.collateralCost * ratio;
            basis.collateralCost = Math.max(0, basis.collateralCost - costRemoved);
            basis.collateralAmount = Math.max(0, basis.collateralAmount - amount);
          }
        } else if (kind === "borrow") {
          // Add to debt cost basis
          basis.debtCost += amountUsd;
          basis.debtAmount += amount;
        } else if (kind === "repay") {
          // Remove from debt proportionally (average cost method)
          if (basis.debtAmount > 0) {
            const ratio = Math.min(1, amount / basis.debtAmount);
            const costRemoved = basis.debtCost * ratio;
            basis.debtCost = Math.max(0, basis.debtCost - costRemoved);
            basis.debtAmount = Math.max(0, basis.debtAmount - amount);
          }
        }
      }
    }
  });

  const netCollateralFlow = totals.withdrawUsd - totals.supplyUsd;
  const netDebtFlow = totals.borrowUsd - totals.repayUsd;

  // Fetch current position for mark-to-market
  const currentPositions = await fetchCurrentPosition(
    wallet.address,
    wallet.chain,
    wallet.protocol as Protocol,
  );

  // Calculate mark-to-market P&L
  let markToMarketPnl = 0;
  let currentCollateralValue = 0;
  let currentDebtValue = 0;
  let historicalCollateralCost = 0;
  let historicalDebtCost = 0;

  for (const position of currentPositions) {
    currentCollateralValue += position.collateralUsd;
    currentDebtValue += position.debtUsd;

    const assetKey = position.address.toLowerCase();
    const basis = assetCostBasis.get(assetKey);

    if (position.collateralAmount > 0) {
      if (basis && basis.collateralAmount > 0) {
        // Calculate average cost per unit from historical events
        const avgCollateralCostPerUnit = basis.collateralCost / basis.collateralAmount;
        // Current collateral cost = current amount * average cost per unit
        const currentCollateralCost = position.collateralAmount * avgCollateralCostPerUnit;
        historicalCollateralCost += currentCollateralCost;
        // P&L for collateral = Current Value - Historical Cost
        markToMarketPnl += position.collateralUsd - currentCollateralCost;
      } else {
        // No historical cost basis, assume cost = current value (no P&L)
        historicalCollateralCost += position.collateralUsd;
      }
    }

    if (position.debtAmount > 0) {
      if (basis && basis.debtAmount > 0) {
        // Calculate average cost per unit from historical events
        const avgDebtCostPerUnit = basis.debtCost / basis.debtAmount;
        // Current debt cost = current amount * average cost per unit
        const currentDebtCost = position.debtAmount * avgDebtCostPerUnit;
        historicalDebtCost += currentDebtCost;
        // P&L for debt = Historical Cost - Current Value (debt is negative)
        markToMarketPnl -= position.debtUsd - currentDebtCost;
      } else {
        // No historical cost basis, assume cost = current value (no P&L)
        historicalDebtCost += position.debtUsd;
      }
    }
  }

  // Calculate debt P&L: quanto emprestaste vs quanto vale agora
  // "Quanto emprestaste" = Total líquido emprestado (borrows - repays) em USD histórico
  // Este valor não muda - é a soma histórica dos borrows menos os repays
  const totalBorrowedUsd = totals.borrowUsd - totals.repayUsd;
  
  // Se não temos eventos históricos mas temos dívida atual, usar o custo médio ponderado como fallback
  // Isso acontece quando os eventos não estão sincronizados ou não têm amount_usd
  const borrowedUsd = totalBorrowedUsd > 0 
    ? totalBorrowedUsd 
    : (historicalDebtCost > 0 ? historicalDebtCost : 0);
  
  // P&L para dívida: se emprestaste $100 e agora deves $90, isso é um GANHO de $10
  // P&L = Valor emprestado - Valor atual (positivo = ganho, negativo = perda)
  const debtPnl = borrowedUsd - currentDebtValue;

  return NextResponse.json({
    walletId,
    totals,
    netCollateralFlow,
    netDebtFlow,
    debtPnl: {
      borrowedUsd: borrowedUsd, // Quanto emprestaste (total líquido em USD histórico, ou custo médio ponderado como fallback)
      currentValueUsd: currentDebtValue, // Quanto vale agora
      pnl: debtPnl, // P&L = Valor atual - Custo histórico
    },
    markToMarket: {
      pnl: markToMarketPnl,
      currentCollateralValue,
      currentDebtValue,
      historicalCollateralCost,
      historicalDebtCost,
      netPositionValue: currentCollateralValue - currentDebtValue,
      netHistoricalCost: historicalCollateralCost - historicalDebtCost,
    },
  });
}
