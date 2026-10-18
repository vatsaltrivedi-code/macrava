#!/bin/bash
# Runs supabase/schema.sql against a throwaway Postgres with a minimal stand-in for Supabase's auth schema,
# then checks that a user can only see/change their own row and anon sees nothing.
set -u
D=$(mktemp -d); BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); PORT=55432
cleanup(){ su postgres -c "$BIN/pg_ctl -D $D/data -m immediate stop" >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
chown postgres "$D"; su postgres -c "$BIN/initdb -D $D/data -A trust" >/dev/null
su postgres -c "$BIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log start -w" >/dev/null
Q(){ su postgres -c "psql -h $D -p $PORT -d postgres -v ON_ERROR_STOP=1 -qAt" ; }
Q <<'SQL' >/dev/null
create role anon; create role authenticated;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
SQL
# Like Supabase: new tables get every privilege for API roles by default
echo "alter default privileges in schema public grant all on tables to anon, authenticated;" | Q >/dev/null
Q < supabase/schema.sql >/dev/null || { echo "FAIL schema applies"; exit 1; }
echo "PASS schema applies"
Q <<'SQL' >/dev/null
SQL
A=11111111-1111-1111-1111-111111111111; B=22222222-2222-2222-2222-222222222222
as(){ printf "set role %s; set request.jwt.sub = '%s';\n%s\n" "$1" "$2" "$3" | Q 2>&1 | tail -1; }
fail=0; eq(){ if [[ "$2" == "$3" ]]; then echo "PASS $1"; else echo "FAIL $1 (got: $2)"; fail=1; fi; }
chk(){ if [[ "$2" == *"$3"* ]]; then echo "PASS $1"; else echo "FAIL $1 (got: $2)"; fail=1; fi; }
chk "A inserts own row" "$(as authenticated $A "insert into public.profiles(id,name,state) values ('$A','Asha','{\"budget\":200}'); select count(*) from public.profiles;")" "1"
chk "B cannot insert A's row" "$(as authenticated $B "insert into public.profiles(id,name) values ('$A','x');")" "row-level security"
as authenticated $B "insert into public.profiles(id,name) values ('$B','Bo');" >/dev/null
eq "B sees only own row" "$(as authenticated $B "select string_agg(name, ',') from public.profiles;")" "Bo"
eq "B cannot update A" "$(as authenticated $B "update public.profiles set name='hack' where id='$A'; select count(*) from public.profiles where id='$A';")" "0"
chk "A still Asha" "$(as authenticated $A "select name from public.profiles;")" "Asha"
chk "B cannot delete own row" "$(as authenticated $B "delete from public.profiles;")" "permission denied"
eq "B's row still there" "$(as authenticated $B "select count(*) from public.profiles;")" "1"
chk "anon denied" "$(as anon '' "select count(*) from public.profiles;")" "permission denied"
chk "updated_at moves on update" "$(as authenticated $A "select updated_at from public.profiles \\gset
select pg_sleep(0.05); update public.profiles set city='Pune'; select (updated_at > :'updated_at'::timestamptz)::text from public.profiles;")" "true"
chk "name length limit" "$(as authenticated $A "update public.profiles set name=repeat('x',61);")" "check constraint"
chk "state size limit" "$(as authenticated $A "update public.profiles set state=jsonb_build_object('x', (select string_agg(md5(i::text),'') from generate_series(1,8000) i));")" "check constraint"
# Pro interest: anyone can answer through the function, nobody can read or edit the table
D1=aaaaaaaa-0000-0000-0000-000000000001; D2=aaaaaaaa-0000-0000-0000-000000000002
chk "anon records interest" "$(as anon '' "select public.record_pro_interest('$D1','yes','week',100);")" ""
as authenticated $A "select public.record_pro_interest('$D2','no','eatout',100);" >/dev/null
as anon '' "select public.record_pro_interest('$D1','no','shop',79);" >/dev/null
eq "one row per device, answer updated" "$(echo "select string_agg(device::text||':'||answer||':'||feature||':'||price||':'||coalesce(user_id::text,'-'), ',' order by device) from public.pro_interest;" | Q)" "$D1:no:shop:79:-,$D2:no:eatout:100:$A"
chk "bad answer refused" "$(as anon '' "select public.record_pro_interest('$D1','maybe','week',100);")" "at RAISE"
chk "price must be sensible" "$(as anon '' "select public.record_pro_interest('$D1','yes','week',0);")" "at RAISE"
chk "anon cannot read interest" "$(as anon '' "select count(*) from public.pro_interest;")" "permission denied"
chk "user cannot read interest" "$(as authenticated $A "select count(*) from public.pro_interest;")" "permission denied"
chk "user cannot insert directly" "$(as authenticated $A "insert into public.pro_interest(device,answer,feature) values (gen_random_uuid(),'yes','week');")" "permission denied"
# Usage counts: one row per device/day/event through the function; nobody can read them through the app
U1=bbbbbbbb-0000-0000-0000-000000000001
as anon '' "select public.record_usage('$U1','open'); select public.record_usage('$U1','open'); select public.record_usage('$U1','plan');" >/dev/null
eq "usage: duplicates in a day ignored" "$(echo "select count(*) from public.usage_events;" | Q)" "2"
chk "usage: bad event refused" "$(as anon '' "select public.record_usage('$U1','hack');")" "at RAISE"
chk "usage: anon cannot read events" "$(as anon '' "select count(*) from public.usage_events;")" "permission denied"
chk "usage: anon cannot read daily view" "$(as anon '' "select * from public.usage_daily;")" "permission denied"
chk "usage: user cannot read totals view" "$(as authenticated $A "select * from public.usage_totals;")" "permission denied"
eq "usage: daily view counts" "$(echo "select visitors||','||made_a_plan from public.usage_daily;" | Q)" "1,1"
# delete_my_account(): only the caller's account goes, everyone else's stays
chk "anon cannot delete accounts" "$(as anon '' "select public.delete_my_account();")" "permission denied"
as authenticated $B "select public.delete_my_account();" >/dev/null
eq "B's sign-in removed" "$(echo "select count(*) from auth.users where id='$B';" | Q)" "0"
eq "B's profile removed" "$(echo "select count(*) from public.profiles where id='$B';" | Q)" "0"
eq "A's sign-in kept" "$(echo "select count(*) from auth.users where id='$A';" | Q)" "1"
eq "interest answers kept" "$(echo "select count(*) from public.pro_interest;" | Q)" "2"
eq "A's profile kept" "$(echo "select count(*) from public.profiles where id='$A';" | Q)" "1"
[ $fail = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
