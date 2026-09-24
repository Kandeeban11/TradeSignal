-- Run in Supabase SQL Editor after enabling Email auth.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'trader' check (role in ('admin', 'trader')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  asset text not null,
  side text not null check (side in ('Long', 'Short')),
  entry numeric not null,
  exit numeric,
  quantity numeric not null default 0,
  pnl numeric not null default 0,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.paper_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"account":{"balance":1000,"initial":1000},"open":[],"closed":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists trades_user_closed_idx on public.trades(user_id, closed_at desc);

create or replace view public.monthly_pnl as
select date_trunc('month', coalesce(closed_at, opened_at))::date as month,
       user_id,
       coalesce(sum(pnl), 0)::numeric as pnl,
       count(*)::int as trade_count
from public.trades
group by 1, 2;

alter table public.profiles enable row level security;
alter table public.trades enable row level security;
alter table public.paper_accounts enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active'); $$;

create policy "users can read their profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "admins can read all profiles" on public.profiles for select to authenticated using (public.is_admin());
create policy "admins can update trader profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "users can read their trades" on public.trades for select to authenticated using (user_id = auth.uid());
create policy "admins can read all trades" on public.trades for select to authenticated using (public.is_admin());
create policy "users can insert their trades" on public.trades for insert to authenticated with check (user_id = auth.uid());
create policy "users can update their trades" on public.trades for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users can read their paper account" on public.paper_accounts for select to authenticated using (user_id = auth.uid());
create policy "users can create their paper account" on public.paper_accounts for insert to authenticated with check (user_id = auth.uid());
create policy "users can update their paper account" on public.paper_accounts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Create the first admin in Authentication, then insert their matching profile:
-- insert into public.profiles (id, full_name, email, role) values ('AUTH_USER_UUID', 'Your Name', 'you@example.com', 'admin');
