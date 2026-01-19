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
```

### RLS

```sql
alter table user_wallets enable row level security;
alter table wallet_hf_targets enable row level security;
alter table wallet_strategy_notes enable row level security;

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
