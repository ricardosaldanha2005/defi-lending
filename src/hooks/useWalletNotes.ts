"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function useWalletNotes(walletId: string) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [notes, setNotes] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!walletId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("wallet_strategy_notes")
      .select("notes")
      .eq("wallet_id", walletId)
      .eq("strategy_name", "bearmarket_lending_borrow")
      .maybeSingle();

    if (!error && data?.notes) {
      setNotes(data.notes);
    }
    setLoading(false);
  }, [supabase, walletId]);

  const saveNotes = useCallback(
    async (value: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return { error: new Error("Not authenticated") };
      }

      const { error } = await supabase.from("wallet_strategy_notes").upsert({
        user_id: user.id,
        wallet_id: walletId,
        strategy_name: "bearmarket_lending_borrow",
        notes: value,
      });
      if (!error) {
        setNotes(value);
      }
      return { error };
    },
    [supabase, walletId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { notes, setNotes, saveNotes, loading };
}
