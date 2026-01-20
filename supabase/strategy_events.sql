-- Strategy events history + sync state
-- Safe to run multiple times.

create table if not exists strategy_events (
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

create table if not exists strategy_event_sync (
  wallet_id uuid primary key references user_wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  protocol text not null,
  chain text not null,
  last_synced_timestamp bigint not null default 0,
  last_synced_block bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- RLS
alter table strategy_events enable row level security;
alter table strategy_event_sync enable row level security;

drop policy if exists "manage strategy events" on strategy_events;
create policy "manage strategy events" on strategy_events
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "manage strategy event sync" on strategy_event_sync;
create policy "manage strategy event sync" on strategy_event_sync
for all using (user_id = auth.uid())
with check (user_id = auth.uid());
