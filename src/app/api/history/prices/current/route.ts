import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchHistoricalTokenPriceUsd } from "@/lib/history/prices";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { items?: Array<{ chain: string; tokenAddress: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length > 50) {
    return NextResponse.json(
      { error: "Too many items (max 50)" },
      { status: 400 },
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const prices = await Promise.all(
    items.map(({ chain, tokenAddress }) =>
      fetchHistoricalTokenPriceUsd({
        chain,
        tokenAddress,
        timestampSec: nowSec,
      }),
    ),
  );

  return NextResponse.json({ prices });
}
