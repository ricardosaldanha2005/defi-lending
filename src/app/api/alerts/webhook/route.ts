import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userId: user.id,
      ...payload,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("webhook.forward", response.status, text);
    return NextResponse.json(
      {
        error: "Webhook request failed",
        status: response.status,
        body: text,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
