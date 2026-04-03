create table if not exists public.imported_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source text not null,
  external_id text not null,
  transaction_date date not null,
  original_date date,
  account_type text,
  account_name text,
  account_number text,
  institution_name text,
  merchant_name text not null,
  custom_name text,
  amount numeric(12, 2) not null,
  description text,
  category text,
  note text,
  ignored_from text,
  tax_deductible boolean not null default false,
  transaction_tags text[] not null default '{}',
  raw_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (household_id, source, external_id)
);

alter table public.imported_transactions enable row level security;

create policy "imported_transactions_select_member"
on public.imported_transactions
for select
using (public.is_household_member(household_id));

create policy "imported_transactions_insert_member"
on public.imported_transactions
for insert
with check (public.is_household_member(household_id));

create policy "imported_transactions_update_member"
on public.imported_transactions
for update
using (public.is_household_member(household_id));

create policy "imported_transactions_delete_member"
on public.imported_transactions
for delete
using (public.is_household_member(household_id));
