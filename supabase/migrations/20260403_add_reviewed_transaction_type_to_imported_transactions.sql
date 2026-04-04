alter table public.imported_transactions
add column if not exists reviewed_transaction_type text;
