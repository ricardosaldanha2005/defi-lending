"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { DEFAULT_HF_MAX, DEFAULT_HF_MIN } from "@/lib/constants";
import { DEFAULT_PROTOCOL, Protocol } from "@/lib/protocols";

export type WalletRow = {
  id: string;
  address: string;
  label: string | null;
  chain: string;
  protocol: Protocol;
  created_at: string;
  wallet_hf_targets?: {
    hf_min: number;
    hf_max: number;
  } | null;
};

export function useWallets() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_wallets")
      .select(
        "id,address,label,chain,protocol,created_at,wallet_hf_targets ( hf_min, hf_max )",
      )
      .order("created_at", { ascending: false });

    if (!error && data) {
      setWallets(
        data.map((row) => {
          const target = Array.isArray(row.wallet_hf_targets)
            ? row.wallet_hf_targets[0]
            : row.wallet_hf_targets;
          const hfMin = target ? Number(target.hf_min) : DEFAULT_HF_MIN;
          const hfMax = target ? Number(target.hf_max) : DEFAULT_HF_MAX;
          return {
            ...row,
            protocol: (row.protocol ?? DEFAULT_PROTOCOL) as Protocol,
            wallet_hf_targets: {
              hf_min: hfMin,
              hf_max: hfMax,
            },
          };
        }),
      );
    }
    setLoading(false);
  }, [supabase]);

  const addWallet = useCallback(
    async (payload: {
      address: string;
      label?: string;
      chain: string;
      protocol: Protocol;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return { error: new Error("Not authenticated") };
      }

      const { error } = await supabase.from("user_wallets").insert({
        user_id: user.id,
        address: payload.address,
        label: payload.label ?? null,
        chain: payload.chain,
        protocol: payload.protocol,
      });

      if (!error) {
        await refresh();
        return { error: null, errorMessage: null };
      }
      const errorMessage =
        error.code === "23505" || error.message?.includes("duplicate")
          ? "Esta wallet já existe para esta chain e protocolo."
          : "Não foi possível adicionar a wallet.";
      return { error, errorMessage };
    },
    [refresh, supabase],
  );

  const updateTargets = useCallback(
    async (walletId: string, hfMin: number, hfMax: number) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return { error: new Error("Not authenticated") };
      }

      const { error } = await supabase
        .from("wallet_hf_targets")
        .upsert(
          {
            user_id: user.id,
            wallet_id: walletId,
            hf_min: hfMin,
            hf_max: hfMax,
          },
          { onConflict: "wallet_id" },
        );

      if (!error) {
        await refresh();
      }
      return { error };
    },
    [refresh, supabase],
  );

  const removeWallet = useCallback(
    async (walletId: string) => {
      const { error } = await supabase
        .from("user_wallets")
        .delete()
        .eq("id", walletId);
      if (!error) {
        await refresh();
      }
      return { error };
    },
    [refresh, supabase],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { wallets, loading, refresh, addWallet, removeWallet, updateTargets };
}
