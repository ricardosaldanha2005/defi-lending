import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAaveChain } from "@/lib/aave/chains";
import { Protocol } from "@/lib/protocols";

type TypeRef = {
  kind: string;
  name?: string | null;
  ofType?: TypeRef | null;
};

type QueryFieldInfo = {
  name: string;
  args: Array<{ name: string; type: TypeRef }>;
  type: TypeRef;
};

function unwrapTypeName(typeRef: TypeRef | null | undefined): string | null {
  let current = typeRef;
  while (current) {
    if (current.kind === "NON_NULL" || current.kind === "LIST") {
      current = current.ofType ?? null;
      continue;
    }
    return current.name ?? null;
  }
  return null;
}

async function postGraphQL<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; errors?: { message?: string }[] }
    | null;
  if (!response.ok || !payload?.data) {
    const message = payload?.errors?.[0]?.message;
    throw new Error(message || "Subgraph request failed.");
  }
  return payload.data;
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
  const event = (searchParams.get("event") ?? "deposits").trim();
  if (!walletId) {
    return NextResponse.json({ error: "walletId required" }, { status: 400 });
  }

  const { data: wallet, error: walletError } = await supabase
    .from("user_wallets")
    .select("id,user_id,chain,protocol")
    .eq("id", walletId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (walletError) {
    console.error("history.events.debug.wallet", walletError);
    return NextResponse.json({ error: "Failed to load wallet" }, { status: 500 });
  }

  if (!wallet) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  const protocol = (wallet.protocol ?? "aave") as Protocol;
  if (protocol !== "aave") {
    return NextResponse.json(
      { error: "Debug only supports Aave for now" },
      { status: 400 },
    );
  }

  const chain = parseAaveChain(wallet.chain) ?? "polygon";
  const subgraphUrl =
    chain === "arbitrum"
      ? process.env.AAVE_SUBGRAPH_ARBITRUM
      : process.env.AAVE_SUBGRAPH_POLYGON;

  if (!subgraphUrl) {
    return NextResponse.json(
      { error: "Missing Aave subgraph URL" },
      { status: 400 },
    );
  }

  try {
    const schemaInfo = await postGraphQL<{
      __schema?: { queryType?: { fields?: QueryFieldInfo[] } };
    }>(
      subgraphUrl,
      `
        query SchemaInfo {
          __schema {
            queryType {
              fields {
                name
                type { kind name ofType { kind name ofType { kind name } } }
                args {
                  name
                  type { kind name ofType { kind name ofType { kind name } } }
                }
              }
            }
          }
        }
      `,
      {},
    );

    const queryFields = schemaInfo.__schema?.queryType?.fields ?? [];
    const targetField =
      queryFields.find((field) => field.name === event) ??
      queryFields.find((field) => field.name === event + "s") ??
      queryFields.find((field) => field.name.endsWith(event)) ??
      null;

    if (!targetField) {
      return NextResponse.json({
        queryFields: queryFields.map((field) => field.name),
        error: "Event query field not found",
      });
    }

    const eventTypeName = unwrapTypeName(targetField.type);
    const eventType = eventTypeName
      ? await postGraphQL<{
          __type?: { fields?: Array<{ name: string; type: TypeRef }> };
        }>(
          subgraphUrl,
          `
            query EventType($name: String!) {
              __type(name: $name) {
                fields {
                  name
                  type { kind name ofType { kind name ofType { kind name } } }
                }
              }
            }
          `,
          { name: eventTypeName },
        )
      : null;

    const eventFields = eventType?.__type?.fields ?? [];
    const nestedCandidates = eventFields
      .filter((field) => unwrapTypeName(field.type))
      .map((field) => field.name);

    return NextResponse.json({
      queryFields: queryFields.map((field) => ({
        name: field.name,
        args: field.args.map((arg) => arg.name),
      })),
      eventQueryField: targetField.name,
      eventTypeName,
      eventFields: eventFields.map((field) => field.name),
      nestedCandidates,
    });
  } catch (error) {
    console.error("history.events.debug", error);
    return NextResponse.json(
      {
        error: "Failed to inspect subgraph",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
