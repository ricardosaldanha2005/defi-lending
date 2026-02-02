# DeFi Risk Manager (V1)

Assistente de decisão para gerir risco e equilíbrio do portfólio DeFi com foco
na estratégia “Lending + Borrow com viés Bearmarket” no Aave v3 (Polygon).

## Stack

- Next.js (App Router) + TypeScript
- TailwindCSS + shadcn/ui
- Supabase (Auth + Postgres + RLS)
- viem para chamadas on-chain

## Configuração do Supabase

### Tabelas

```sql
create table user_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  address text not null,
  chain text not null default 'polygon',
  protocol text not null default 'aave',
  label text,
  created_at timestamptz not null default now(),
  unique (user_id, address, chain, protocol)
);

create table wallet_hf_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  wallet_id uuid not null references user_wallets(id),
  hf_min numeric not null,
  hf_max numeric not null,
  updated_at timestamptz not null default now(),
  unique (wallet_id)
);

create table wallet_strategy_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  wallet_id uuid not null references user_wallets(id),
  strategy_name text not null,
  notes text,
  updated_at timestamptz not null default now(),
  unique (wallet_id, strategy_name)
);

create table strategy_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  wallet_id uuid not null references user_wallets(id),
  chain text not null,
  protocol text not null,
  total_collateral_usd numeric not null,
  total_debt_usd numeric not null,
  health_factor numeric not null,
  liquidation_threshold_bps numeric not null,
  captured_at timestamptz not null default now()
);

create table strategy_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  wallet_id uuid not null references user_wallets(id),
  protocol text not null,
  chain text not null,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  block_timestamp timestamptz not null,
  event_type text not null,
  asset_address text,
  asset_symbol text,
  asset_decimals integer,
  amount_raw text,
  amount numeric,
  price_usd numeric,
  amount_usd numeric,
  created_at timestamptz not null default now(),
  unique (wallet_id, tx_hash, log_index)
);

create table strategy_event_sync (
  wallet_id uuid primary key references user_wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  protocol text not null,
  chain text not null,
  last_synced_timestamp bigint not null default 0,
  last_synced_block bigint not null default 0,
  updated_at timestamptz not null default now()
);
```

### RLS

```sql
alter table user_wallets enable row level security;
alter table wallet_hf_targets enable row level security;
alter table wallet_strategy_notes enable row level security;
alter table strategy_snapshots enable row level security;
alter table strategy_events enable row level security;
alter table strategy_event_sync enable row level security;

create policy "users can manage their wallets" on user_wallets
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "manage hf targets" on wallet_hf_targets
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "manage strategy notes" on wallet_strategy_notes
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "manage strategy snapshots" on strategy_snapshots
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "manage strategy events" on strategy_events
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "manage strategy event sync" on strategy_event_sync
for all using (user_id = auth.uid())
with check (user_id = auth.uid());
```

Se já criaste a tabela com `unique (user_id, address)` e queres permitir
o mesmo address em chains diferentes, executa:

```sql
alter table user_wallets drop constraint if exists user_wallets_user_id_address_key;
alter table user_wallets add column if not exists protocol text not null default 'aave';
alter table user_wallets add constraint user_wallets_user_id_address_chain_protocol_key
unique (user_id, address, chain, protocol);

alter table strategy_snapshots add column if not exists protocol text not null default 'aave';
```

## Variáveis de ambiente

Cria um `.env.local` (ou `.env.example` para versionar) na raiz:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
POLYGON_RPC_URL=https://polygon-rpc.com
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
COMPOUND_COMET_ARBITRUM=
BASE_RPC_URL=https://mainnet.base.org
COMPOUND_COMET_BASE=
N8N_WEBHOOK_URL=https://ricardon8n.duckdns.org/webhook-test/defi-lending
AAVE_SUBGRAPH_POLYGON=https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/6yuf1C49aWEscgk5n9D1DekeG1BCk5Z9imJYJT3sVmAT
AAVE_SUBGRAPH_ARBITRUM=https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf
COMPOUND_SUBGRAPH_ARBITRUM=https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/5MjRndNWGhqvNX7chUYLQDnvEgc8DaH8eisEkcJt71SR
COMPOUND_SUBGRAPH_BASE=https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/2hcXhs36pTBDVUmk5K2Zkr6N4UYGwaHuco2a6jyTsijo
# Opcional: subgraph que indexa eventos Borrow/Repay (quando e quanto). Se definido, é usado para o histórico em vez do subgraph principal (PositionAccounting).
# COMPOUND_SUBGRAPH_ARBITRUM_EVENTS=
# COMPOUND_SUBGRAPH_BASE_EVENTS=
# The Graph: se a URL for gateway.thegraph.com/api/subgraphs/id/... sem API key, define GRAPH_API_KEY (obtém em thegraph.com/studio) e a app injeta-a na URL.
# GRAPH_API_KEY=
COINGECKO_API_KEY=
```

## Histórico e P&L (eventos on-chain)

### Histórico Borrow/Repay no Compound

O subgraph principal do Compound (`COMPOUND_SUBGRAPH_BASE` / `COMPOUND_SUBGRAPH_ARBITRUM`) expõe **PositionAccounting** (estado da posição), não eventos Borrow/Repay com data e valor. Para ver **quando e quanto** fizeste borrows e repays:

1. Usa um subgraph que indexe eventos Borrow/Repay (ex.: Goldsky, The Graph com schema de eventos, ou outro deployment).
2. Define as variáveis opcionais no `.env` ou `.env.local`:
   - `COMPOUND_SUBGRAPH_BASE_EVENTS=<URL do subgraph de eventos Base>`
   - `COMPOUND_SUBGRAPH_ARBITRUM_EVENTS=<URL do subgraph de eventos Arbitrum>`
   - Se usares The Graph e a URL for `.../api/subgraphs/id/...` (sem API key no path), define também `GRAPH_API_KEY=<tua API key>` (cria em [thegraph.com/studio](https://thegraph.com/studio)); a app injeta-a na URL.
3. Reinicia o servidor (`npm run dev`) após alterar `.env.local`.
4. Sincroniza de novo (botão "Sincronizar eventos" na aba Histórico).

Se estas variáveis não estiverem definidas, o histórico Compound usa o subgraph principal e mostra registos de posição (datas aproximadas, tipo UNKNOWN).

### Sync de eventos

```
POST /api/history/events/sync
Body: { "walletId": "...", "includePrices": true }
```

### Ler eventos

```
GET /api/history/events?walletId=...&limit=200
```

### P&L básico (fluxos)

```
GET /api/history/pnl?walletId=...
```

Nota: esta workspace bloqueia a criação automática de ficheiros `.env`, por isso
cria manualmente.

## Executar localmente

```
npm install
npm run dev
```

Abrir `http://localhost:3000`.

## Testar com um address real

1. Fazer login com magic link.
2. Adicionar 1-2 wallets Polygon com posição no Aave v3.
3. Ver o Health Factor e recomendações no dashboard.
4. Definir HF_min e HF_max por wallet.
5. Usar o simulador “E se…” no detalhe da wallet.

## Notas

- A app é read-only: não executa transações e não conecta wallet.
- O RPC pode ser configurado via `POLYGON_RPC_URL`. O campo em `/app/settings`
  guarda preferência local (para V2 integrar com o backend).
