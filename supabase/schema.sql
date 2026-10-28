-- Macro Budget Planner: accounts table. Paste into Supabase > SQL Editor and run once.
-- Each signed-in user gets one row; Row Level Security lets them see and change only their own.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text check (char_length(name) <= 60),
  city        text check (char_length(city) <= 40),
  area        text check (char_length(area) <= 80),
  state       jsonb not null default '{}'::jsonb check (pg_column_size(state) <= 200000),
  updated_at  timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "create own profile" on public.profiles;
create policy "create own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Signed-in users may read, create and update (RLS above limits them to their own row). No delete.
-- Supabase grants every privilege on new tables by default, so take them all away first.
revoke all on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;

-- No delete policy: rows go away only when the auth user is deleted (on delete cascade).
-- Anonymous (not signed-in) visitors get no access at all.
revoke all on public.profiles from anon;

-- "Delete my account": removes the caller's sign-in, and their profile with it (on delete cascade).
-- Runs with owner rights so it can reach auth.users, but only ever touches auth.uid() — the caller.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- "Pro – coming soon" interest: one answer per device (and account, if signed in).
-- Nobody can read or write the table directly; the app only calls record_pro_interest().
create table if not exists public.pro_interest (
  device uuid primary key,
  user_id uuid references auth.users (id) on delete set null,
  answer text not null check (answer in ('yes', 'no')),
  feature text not null check (feature in ('week', 'shop', 'eatout')),
  price int not null check (price between 1 and 10000),   -- the monthly price (₹) the person was asked about
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pro_interest enable row level security;
revoke all on public.pro_interest from anon, authenticated;

create or replace function public.record_pro_interest(p_device uuid, p_answer text, p_feature text, p_price int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_device is null or p_answer not in ('yes', 'no') or p_feature not in ('week', 'shop', 'eatout')
     or p_price is null or p_price not between 1 and 10000 then
    raise exception 'bad input';
  end if;
  -- A cap so a script can't fill the table
  if (select count(*) from public.pro_interest) >= 20000
     and not exists (select 1 from public.pro_interest where device = p_device) then
    return;
  end if;
  insert into public.pro_interest (device, user_id, answer, feature, price)
  values (p_device, auth.uid(), p_answer, p_feature, p_price)
  on conflict (device) do update
    set answer = excluded.answer, feature = excluded.feature, price = excluded.price,
        user_id = coalesce(excluded.user_id, public.pro_interest.user_id), updated_at = now();
end $$;

revoke all on function public.record_pro_interest(uuid, text, text, int) from public;
grant execute on function public.record_pro_interest(uuid, text, text, int) to anon, authenticated;

-- Launch metrics: anonymous usage counts. One row per device, per day (India time), per event.
-- q0-q3: reached question 1-4 of the setup quiz, to see where people stop before their first plan.
-- No names or plan data: just a random device ID made by the app, the day and what happened.
create table if not exists public.usage_events (
  device uuid not null,
  day date not null,
  event text not null check (event in ('open', 'plan', 'tick', 'pro', 'account', 'share', 'q0', 'q1', 'q2', 'q3')),
  primary key (device, day, event)
);
-- Older databases: keep the allowed events in step with the app
alter table public.usage_events drop constraint if exists usage_events_event_check;
alter table public.usage_events add constraint usage_events_event_check check (event in ('open', 'plan', 'tick', 'pro', 'account', 'share', 'q0', 'q1', 'q2', 'q3'));
alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon, authenticated;

create or replace function public.record_usage(p_device uuid, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_device is null or p_event not in ('open', 'plan', 'tick', 'pro', 'account', 'share', 'q0', 'q1', 'q2', 'q3') then
    raise exception 'bad input';
  end if;
  -- A cap so a script can't fill the table
  if (select count(*) from public.usage_events) >= 500000 then
    return;
  end if;
  insert into public.usage_events (device, day, event)
  values (p_device, (now() at time zone 'Asia/Kolkata')::date, p_event)
  on conflict do nothing;
end $$;

revoke all on function public.record_usage(uuid, text) from public;
grant execute on function public.record_usage(uuid, text) to anon, authenticated;

-- Read these in Supabase → Table Editor (only you can: the app's roles have no access).
create or replace view public.usage_daily with (security_invoker = true) as
  select day,
         count(distinct device) filter (where event = 'open') as visitors,
         count(distinct device) filter (where event = 'plan') as made_a_plan,
         count(distinct device) filter (where event = 'tick') as ticked_meals,
         count(distinct device) filter (where event = 'pro') as saw_pro,
         count(distinct device) filter (where event = 'account') as signed_in,
         count(distinct device) filter (where event = 'share') as shared,
         count(distinct device) filter (where event = 'q0') as started_quiz,
         count(distinct device) filter (where event = 'q3') as reached_last_question
  from public.usage_events group by day order by day desc;

create or replace view public.usage_totals with (security_invoker = true) as
  select count(distinct device) as devices_ever,
         count(distinct device) filter (where event = 'plan') as devices_with_a_plan,
         (select count(*) from (select device from public.usage_events group by device having count(distinct day) >= 2) r) as came_back_another_day,
         (select count(*) from (select device from public.usage_events group by device having count(distinct day) >= 7) r) as used_on_7_plus_days,
         (select count(*) from public.pro_interest where answer = 'yes') as pro_yes,
         (select count(*) from public.pro_interest where answer = 'no') as pro_no
  from public.usage_events;

revoke all on public.usage_daily, public.usage_totals from anon, authenticated;

-- Food preferences: which foods people eat (tick) and swap out / swap in. Anonymous, like usage_events:
-- a random device ID, the day, the event and the food. Counted once per device, day, event and food.
create table if not exists public.food_events (
  device uuid not null,
  day date not null,
  event text not null check (event in ('ate', 'swap_out', 'swap_in')),
  food_id int not null check (food_id between 0 and 100000),
  food_name text not null check (char_length(food_name) between 1 and 120),
  primary key (device, day, event, food_id)
);
alter table public.food_events enable row level security;
revoke all on public.food_events from anon, authenticated;

create or replace function public.record_food(p_device uuid, p_event text, p_food_id int, p_food_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_device is null or p_event not in ('ate', 'swap_out', 'swap_in') or p_food_id is null
     or p_food_id < 0 or p_food_id > 100000 or p_food_name is null or char_length(p_food_name) not between 1 and 120 then
    raise exception 'bad input';
  end if;
  -- A cap so a script can't fill the table
  if (select count(*) from public.food_events) >= 500000 then
    return;
  end if;
  insert into public.food_events (device, day, event, food_id, food_name)
  values (p_device, (now() at time zone 'Asia/Kolkata')::date, p_event, p_food_id, p_food_name)
  on conflict do nothing;
end $$;

revoke all on function public.record_food(uuid, text, int, text) from public;
grant execute on function public.record_food(uuid, text, int, text) to anon, authenticated;

-- Read in Supabase → Table Editor: one row per food, most eaten first. Counts are devices, not taps.
create or replace view public.food_popularity with (security_invoker = true) as
  select food_id, max(food_name) as food,
         count(distinct device) filter (where event = 'ate') as people_ate,
         count(distinct device) filter (where event = 'swap_in') as people_swapped_in,
         count(distinct device) filter (where event = 'swap_out') as people_swapped_out,
         max(day) as last_seen
  from public.food_events group by food_id
  order by people_ate desc, people_swapped_in desc, people_swapped_out asc;

revoke all on public.food_popularity from anon, authenticated;
