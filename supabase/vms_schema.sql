-- =====================================================================================
-- VMS 3.0 - Supabase database
--
-- HOW TO INSTALL: open your Supabase project -> SQL Editor -> New query, paste this whole
-- file and click "Run". It is safe to run again later (for example after an update): it
-- never deletes data.
--
-- Layout
--   * Every Google Sheet tab (OrderLog, UploadLog, OrderManifest, GTINCatalog, ...) is kept
--     row for row in vms_private.rows, with the cells in the same column order as the Sheet.
--   * The tables live in the private schema "vms_private", which the Supabase API does not
--     expose at all. Row level security is also switched on with no policies, so the anon /
--     publishable key cannot read or change any table directly.
--   * The web app can only call the vms_* functions below that are granted to "anon". Each
--     one checks the VMS sign-in token first (sessions are copied here by Apps Script when
--     a user signs in).
--   * The sync functions (vms_sync_*, vms_mirror_*, vms_reconcile_tab, vms_session_*) can
--     only be called with the service_role / secret key, which is stored in Apps Script and
--     never sent to the browser.
-- =====================================================================================

create schema if not exists vms_private;
revoke all on schema vms_private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema vms_private from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema vms_private from authenticated'; end if;
end $$;

create sequence if not exists vms_private.row_seq start with 10000000;

create table if not exists vms_private.tabs (
  tab        text primary key,
  headers    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists vms_private.rows (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  row_key    text not null,
  seq        double precision not null default nextval('vms_private.row_seq'),
  vals       jsonb not null default '[]'::jsonb,
  version    bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  txid       bigint not null default (pg_current_xact_id()::text::bigint),
  deleted_at timestamptz
);
create unique index if not exists rows_live_key on vms_private.rows (tab, row_key) where deleted_at is null;
create index if not exists rows_txid on vms_private.rows (txid, id);
create index if not exists rows_tab_seq on vms_private.rows (tab, seq);

create table if not exists vms_private.sessions (
  token_hash text primary key,
  email      text not null,
  name       text not null default '',
  role       text not null default 'User',
  expires_at timestamptz not null
);
create index if not exists sessions_email on vms_private.sessions (lower(email));

-- Changes made by the web app that still have to be written into the Google Sheet.
create table if not exists vms_private.outbox (
  id         bigserial primary key,
  row_id     uuid not null,
  tab        text not null,
  op         text not null,
  row_key    text,
  old_key    text,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists outbox_row on vms_private.outbox (row_id);

create table if not exists vms_private.state (
  k          text primary key,
  v          jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

-- Live status of each packing station's upload queue (one row per signed-in packer).
create sequence if not exists vms_private.station_seq;
create table if not exists vms_private.stations (
  email       text primary key,
  name        text not null default '',
  report      jsonb not null default '{}'::jsonb,
  reported_at timestamptz not null default clock_timestamp(),
  version     bigint not null default nextval('vms_private.station_seq')
);

alter table vms_private.tabs     enable row level security;
alter table vms_private.rows     enable row level security;
alter table vms_private.sessions enable row level security;
alter table vms_private.outbox   enable row level security;
alter table vms_private.state    enable row level security;
alter table vms_private.stations enable row level security;
revoke all on all tables in schema vms_private from public;
revoke all on all sequences in schema vms_private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema vms_private from anon';
    execute 'revoke all on all sequences in schema vms_private from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema vms_private from authenticated';
    execute 'revoke all on all sequences in schema vms_private from authenticated';
  end if;
end $$;

-- ------------------------------------------------------------------ triggers

create or replace function vms_private.rows_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.vals is not distinct from old.vals and new.row_key = old.row_key
       and new.deleted_at is not distinct from old.deleted_at and new.seq = old.seq then
      return null; -- nothing changed: skip the write completely
    end if;
    new.version := old.version + 1;
  end if;
  new.updated_at := clock_timestamp();
  new.txid := pg_current_xact_id()::text::bigint;
  return new;
end $$;

drop trigger if exists rows_touch on vms_private.rows;
create trigger rows_touch before insert or update on vms_private.rows
  for each row execute function vms_private.rows_touch();

-- Queue web-app changes for the Google Sheet. Changes that came from the Sheet itself
-- (Apps Script mirror / reconcile) set vms.origin = 'sheet' and are not queued again.
create or replace function vms_private.rows_outbox() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('vms.origin', true), '') = 'sheet' then return null; end if;
  if tg_op = 'INSERT' then
    insert into vms_private.outbox(row_id, tab, op, row_key) values (new.id, new.tab, 'insert', new.row_key);
  elsif new.deleted_at is not null and old.deleted_at is null then
    insert into vms_private.outbox(row_id, tab, op, row_key, old_key) values (new.id, new.tab, 'delete', new.row_key, old.row_key);
  else
    insert into vms_private.outbox(row_id, tab, op, row_key, old_key) values (new.id, new.tab, 'update', new.row_key, old.row_key);
  end if;
  return null;
end $$;

drop trigger if exists rows_outbox on vms_private.rows;
create trigger rows_outbox after insert or update on vms_private.rows
  for each row execute function vms_private.rows_outbox();

-- ------------------------------------------------------------------ helpers

create or replace function vms_private.token_hash(p_token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

create or replace function vms_private.is_admin(p_role text) returns boolean
language sql immutable as $$
  select regexp_replace(lower(coalesce(p_role, '')), '[\s_-]', '', 'g') in ('admin', 'masteradmin', 'superadmin')
$$;

-- Returns the signed-in user for a VMS token or raises VMS_AUTH.
create or replace function vms_private.auth_session(p_token text) returns vms_private.sessions
language plpgsql stable security definer set search_path = vms_private, public as $$
declare s vms_private.sessions;
begin
  select * into s from vms_private.sessions
   where token_hash = vms_private.token_hash(trim(coalesce(p_token, ''))) and expires_at > now();
  if not found then
    raise exception 'VMS_AUTH: session not found or expired' using errcode = 'P0001';
  end if;
  return s;
end $$;

-- Tabs the web app may read. Users and SecurityLog are for administrators only.
create or replace function vms_private.can_read(p_tab text, p_role text) returns boolean
language sql immutable as $$
  select case when p_tab in ('Users', 'SecurityLog') then vms_private.is_admin(p_role) else true end
$$;

-- Tabs the web app may write. Everything else is written by Apps Script and mirrored here.
create or replace function vms_private.can_write(p_tab text) returns boolean
language sql immutable as $$
  select p_tab in ('OrderManifest', 'PackVerificationLog', 'DownloadLog', 'GTINCatalog')
$$;

create or replace function vms_private.row_json(r vms_private.rows) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', r.id, 't', r.tab, 'k', r.row_key, 's', r.seq,
    'v', case when r.deleted_at is null then r.vals else '[]'::jsonb end,
    'n', r.version, 'x', r.txid, 'd', r.deleted_at is not null)
$$;

-- ------------------------------------------------------------------ web app (anon) API

-- Delta download: every row changed since the cursor (including deletions).
-- p_since is the "cursor" returned by the previous call (null = full download). Page through
-- with p_after_txid / p_after_id while "more" is true, then keep "cursor" for next time.
-- The cursor is the oldest transaction still running, so a change that commits late is never
-- skipped (a few rows may be sent twice; the app ignores repeats).
create or replace function public.vms_pull(
  p_token text, p_since bigint default null, p_tabs text[] default null,
  p_after_txid bigint default null, p_after_id uuid default null, p_limit int default 4000)
returns jsonb
language plpgsql stable security definer set search_path = vms_private, public as $$
declare
  u vms_private.sessions;
  lim int := least(greatest(coalesce(p_limit, 4000), 1), 5000);
  v_cursor bigint := pg_snapshot_xmin(pg_current_snapshot())::text::bigint;
  out_rows jsonb;
  n int;
  last_tx bigint;
  last_id uuid;
  tabs_json jsonb;
begin
  u := vms_private.auth_session(p_token);

  select coalesce(jsonb_agg(vms_private.row_json(pg) order by pg.txid, pg.id), '[]'::jsonb), count(*)
    into out_rows, n
    from (
      select r.* from vms_private.rows r
       where (p_since is null or r.txid >= p_since)
         and (p_since is not null or r.deleted_at is null)
         and (p_tabs is null or r.tab = any(p_tabs))
         and vms_private.can_read(r.tab, u.role)
         and (p_after_txid is null or (r.txid, r.id) > (p_after_txid, p_after_id))
       order by r.txid, r.id
       limit lim
    ) pg;

  if n > 0 then
    last_tx := (out_rows->(n - 1)->>'x')::bigint;
    last_id := (out_rows->(n - 1)->>'id')::uuid;
  end if;

  select coalesce(jsonb_object_agg(t.tab, t.headers), '{}'::jsonb) into tabs_json
    from vms_private.tabs t
   where (p_tabs is null or t.tab = any(p_tabs)) and vms_private.can_read(t.tab, u.role);

  return jsonb_build_object(
    'rows', out_rows,
    'more', n >= lim,
    'after_txid', last_tx,
    'after_id', last_id,
    'cursor', v_cursor,
    'now', now(),
    'tabs', tabs_json,
    'user', jsonb_build_object('email', u.email, 'name', u.name, 'role', u.role)
  );
end $$;

-- Apply the row changes the web app made, all or nothing.
-- p_ops: [{op:'insert', id, tab, key, vals} | {op:'update', id, key, vals, version} | {op:'delete', id, version}]
create or replace function public.vms_apply(p_token text, p_ops jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = vms_private, public as $$
declare
  u vms_private.sessions;
  o jsonb;
  r vms_private.rows;
  changed jsonb := '[]'::jsonb;
  v_op text;
  v_id uuid;
begin
  u := vms_private.auth_session(p_token);
  if jsonb_typeof(p_ops) <> 'array' then raise exception 'VMS_BAD_REQUEST: ops must be an array'; end if;
  if jsonb_array_length(p_ops) > 5000 then raise exception 'VMS_BAD_REQUEST: too many changes in one request'; end if;

  for o in select * from jsonb_array_elements(p_ops) loop
    v_op := o->>'op';
    v_id := nullif(o->>'id', '')::uuid;

    if v_op = 'insert' then
      if not vms_private.can_write(o->>'tab') then raise exception 'VMS_FORBIDDEN: % is read-only for the app', o->>'tab'; end if;
      if jsonb_typeof(o->'vals') <> 'array' or coalesce(o->>'key', '') = '' then raise exception 'VMS_BAD_REQUEST: insert needs key and vals'; end if;
      begin
        insert into vms_private.rows(id, tab, row_key, vals)
        values (coalesce(v_id, gen_random_uuid()), o->>'tab', o->>'key', o->'vals')
        returning * into r;
      exception when unique_violation then
        raise exception 'VMS_CONFLICT: % row % already exists', o->>'tab', o->>'key';
      end;

    elsif v_op = 'update' then
      select * into r from vms_private.rows where id = v_id and deleted_at is null for update;
      if not found then raise exception 'VMS_CONFLICT: row % no longer exists', v_id; end if;
      if not vms_private.can_write(r.tab) then raise exception 'VMS_FORBIDDEN: % is read-only for the app', r.tab; end if;
      if o ? 'version' and (o->>'version')::bigint <> r.version then
        raise exception 'VMS_CONFLICT: row % was changed by another station', v_id;
      end if;
      begin
        update vms_private.rows
           set vals = coalesce(o->'vals', vals), row_key = coalesce(nullif(o->>'key', ''), row_key)
         where id = v_id
        returning * into r;
      exception when unique_violation then
        raise exception 'VMS_CONFLICT: % row % already exists', r.tab, o->>'key';
      end;
      if r.id is null then select * into r from vms_private.rows where id = v_id; end if;

    elsif v_op = 'delete' then
      select * into r from vms_private.rows where id = v_id and deleted_at is null for update;
      if not found then continue; end if;
      if not vms_private.can_write(r.tab) then raise exception 'VMS_FORBIDDEN: % is read-only for the app', r.tab; end if;
      if o ? 'version' and (o->>'version')::bigint <> r.version then
        raise exception 'VMS_CONFLICT: row % was changed by another station', v_id;
      end if;
      update vms_private.rows set deleted_at = clock_timestamp() where id = v_id returning * into r;

    elsif v_op = 'tab' then
      if not vms_private.can_write(o->>'tab') then raise exception 'VMS_FORBIDDEN: % is read-only for the app', o->>'tab'; end if;
      insert into vms_private.tabs(tab, headers) values (o->>'tab', coalesce(o->'headers', '[]'::jsonb))
      on conflict (tab) do update set headers = excluded.headers, updated_at = clock_timestamp()
       where vms_private.tabs.headers is distinct from excluded.headers;
      continue;

    else
      raise exception 'VMS_BAD_REQUEST: unknown op %', v_op;
    end if;

    changed := changed || jsonb_build_array(vms_private.row_json(r));
  end loop;

  return jsonb_build_object('rows', changed, 'now', now());
end $$;

-- Who am I (used by the app to confirm the Supabase copy of its sign-in).
create or replace function public.vms_whoami(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = vms_private, public as $$
declare u vms_private.sessions;
begin
  u := vms_private.auth_session(p_token);
  return jsonb_build_object('email', u.email, 'name', u.name, 'role', u.role, 'expires_at', u.expires_at);
end $$;

-- Backup download (administrators): every live row of one tab in Sheet order, paged by seq.
create or replace function public.vms_export(p_token text, p_tab text, p_after_seq double precision default null, p_limit int default 5000)
returns jsonb
language plpgsql stable security definer set search_path = vms_private, public as $$
declare
  u vms_private.sessions;
  lim int := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  out_rows jsonb;
  n int;
  last_seq double precision;
begin
  u := vms_private.auth_session(p_token);
  if not vms_private.is_admin(u.role) then raise exception 'VMS_FORBIDDEN: Administrator permission required.'; end if;
  with page as (
    select r.seq, r.vals from vms_private.rows r
     where r.tab = p_tab and r.deleted_at is null and (p_after_seq is null or r.seq > p_after_seq)
     order by r.seq limit lim
  )
  select coalesce(jsonb_agg(page.vals order by page.seq), '[]'::jsonb), count(*), max(page.seq)
    into out_rows, n, last_seq from page;
  return jsonb_build_object(
    'tab', p_tab,
    'headers', (select headers from vms_private.tabs where tab = p_tab),
    'rows', out_rows, 'more', n >= lim, 'next_seq', last_seq);
end $$;

-- Status for the Settings page (administrators).
create or replace function public.vms_status(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = vms_private, public as $$
declare u vms_private.sessions;
begin
  u := vms_private.auth_session(p_token);
  if not vms_private.is_admin(u.role) then raise exception 'VMS_FORBIDDEN: Administrator permission required.'; end if;
  return vms_private.status_json();
end $$;

-- ------------------------------------------------------------------ Apps Script (service_role) API

create or replace function vms_private.status_json() returns jsonb
language sql stable security definer set search_path = vms_private, public as $$
  select jsonb_build_object(
    'schemaVersion', 2,
    'now', now(),
    'tabs', coalesce((select jsonb_object_agg(tab, n) from (select tab, count(*) n from vms_private.rows where deleted_at is null group by tab) x), '{}'::jsonb),
    'pendingSheetWrites', (select count(*) from vms_private.outbox),
    'oldestPending', (select min(created_at) from vms_private.outbox),
    'state', coalesce((select jsonb_object_agg(k, v) from vms_private.state), '{}'::jsonb))
$$;

create or replace function public.vms_service_status()
returns jsonb language sql stable security definer set search_path = vms_private, public as $$
  select vms_private.status_json()
$$;

create or replace function public.vms_state_put(p_key text, p_value jsonb)
returns void language sql volatile security definer set search_path = vms_private, public as $$
  insert into vms_private.state(k, v) values (p_key, p_value)
  on conflict (k) do update set v = excluded.v, updated_at = clock_timestamp()
$$;

create or replace function public.vms_session_put(p_token_hash text, p_email text, p_name text, p_role text, p_expires_at timestamptz)
returns void language sql volatile security definer set search_path = vms_private, public as $$
  delete from vms_private.sessions where expires_at < now() - interval '1 day';
  insert into vms_private.sessions(token_hash, email, name, role, expires_at)
  values (p_token_hash, coalesce(p_email, ''), coalesce(p_name, ''), coalesce(p_role, 'User'), p_expires_at)
  on conflict (token_hash) do update set email = excluded.email, name = excluded.name, role = excluded.role, expires_at = excluded.expires_at;
$$;

create or replace function public.vms_session_drop(p_token_hash text default null, p_email text default null)
returns int language plpgsql volatile security definer set search_path = vms_private, public as $$
declare n int;
begin
  delete from vms_private.sessions
   where (p_token_hash is not null and token_hash = p_token_hash)
      or (p_email is not null and lower(email) = lower(p_email));
  get diagnostics n = row_count;
  return n;
end $$;

-- Changes waiting for the Sheet, grouped per row: the current cells plus every key the row
-- had, so Apps Script can find it in the Sheet.
create or replace function public.vms_sync_claim(p_limit int default 500)
returns jsonb
language plpgsql volatile security definer set search_path = vms_private, public as $$
declare res jsonb;
begin
  -- Housekeeping: tombstones are only needed until every station has pulled them.
  delete from vms_private.rows where deleted_at is not null and deleted_at < now() - interval '30 days';

  with pend as (
    select row_id, min(id) first_id, max(id) last_id,
           array_agg(distinct x.k) filter (where x.k is not null) keys,
           bool_or(op = 'insert') had_insert
      from vms_private.outbox o
      left join lateral (values (o.row_key), (o.old_key)) x(k) on true
     group by row_id
     order by min(id)
     limit greatest(coalesce(p_limit, 500), 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'row_id', p.row_id, 'last_id', p.last_id, 'tab', r.tab, 'keys', to_jsonb(p.keys),
           'key', r.row_key, 'seq', r.seq, 'vals', r.vals,
           'live', (r.id is not null and r.deleted_at is null), 'had_insert', p.had_insert)
           order by p.first_id), '[]'::jsonb)
    into res
    from pend p left join vms_private.rows r on r.id = p.row_id;

  return jsonb_build_object('items', res, 'headers',
    coalesce((select jsonb_object_agg(tab, headers) from vms_private.tabs), '{}'::jsonb), 'now', now());
end $$;

-- Mark changes as written to the Sheet. Only events up to the claimed id are removed, so a
-- change made while Apps Script was writing stays queued.
create or replace function public.vms_sync_ack(p_items jsonb)
returns int language plpgsql volatile security definer set search_path = vms_private, public as $$
declare n int;
begin
  delete from vms_private.outbox o
   using jsonb_to_recordset(p_items) as x(row_id uuid, last_id bigint)
   where o.row_id = x.row_id and o.id <= x.last_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Apps Script wrote these rows into the Sheet: upsert them by key (not queued back to the Sheet).
create or replace function public.vms_mirror_rows(p_tab text, p_headers jsonb, p_rows jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = vms_private, public as $$
declare x record; n int := 0;
begin
  perform set_config('vms.origin', 'sheet', true);
  if p_headers is not null and jsonb_typeof(p_headers) = 'array' and jsonb_array_length(p_headers) > 0 then
    insert into vms_private.tabs(tab, headers) values (p_tab, p_headers)
    on conflict (tab) do update set headers = excluded.headers, updated_at = clock_timestamp()
     where vms_private.tabs.headers is distinct from excluded.headers;
  end if;
  for x in select * from jsonb_to_recordset(p_rows) as t(key text, vals jsonb) loop
    if coalesce(x.key, '') = '' then continue; end if;
    update vms_private.rows set vals = x.vals where tab = p_tab and row_key = x.key and deleted_at is null;
    if not found then
      if not exists (select 1 from vms_private.rows where tab = p_tab and row_key = x.key and deleted_at is null) then
        insert into vms_private.rows(tab, row_key, vals) values (p_tab, x.key, x.vals);
      end if;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('rows', n, 'now', now());
end $$;

-- Make Supabase match a whole Sheet tab (first copy, after admin tools that delete rows,
-- and the hourly safety sweep). Rows the app changed after p_started_at, or that are still
-- waiting to be written to the Sheet, are left alone so no app change is ever lost.
create or replace function public.vms_reconcile_tab(p_tab text, p_headers jsonb, p_rows jsonb, p_started_at timestamptz, p_allow_delete boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = vms_private, public
set statement_timeout = '120s' as $$
declare
  v_ins int := 0; v_upd int := 0; v_del int := 0; v_n int;
  v_base double precision;
begin
  perform set_config('vms.origin', 'sheet', true);

  if p_headers is not null and jsonb_typeof(p_headers) = 'array' then
    insert into vms_private.tabs(tab, headers) values (p_tab, p_headers)
    on conflict (tab) do update set headers = excluded.headers, updated_at = clock_timestamp()
     where vms_private.tabs.headers is distinct from excluded.headers;
  end if;

  create temp table if not exists vms_incoming (idx int, key text, vals jsonb) on commit drop;
  truncate vms_incoming;
  insert into vms_incoming
    select (t.ord - 1)::int, t.e->>'key', t.e->'vals'
      from jsonb_array_elements(p_rows) with ordinality t(e, ord)
     where coalesce(t.e->>'key', '') <> '';

  create temp table if not exists vms_protected (id uuid primary key) on commit drop;
  truncate vms_protected;
  insert into vms_protected
    select r.id from vms_private.rows r
     where r.tab = p_tab and (r.updated_at > p_started_at or exists (select 1 from vms_private.outbox o where o.row_id = r.id));

  -- 1. changed cells
  update vms_private.rows r set vals = i.vals
    from vms_incoming i
   where r.tab = p_tab and r.deleted_at is null and r.row_key = i.key
     and r.vals is distinct from i.vals
     and not exists (select 1 from vms_protected p where p.id = r.id);
  get diagnostics v_upd = row_count;

  -- 2. rows only in the Sheet: insert them in Sheet order between their neighbours
  select count(*) into v_n from vms_incoming i
   where not exists (select 1 from vms_private.rows r where r.tab = p_tab and r.deleted_at is null and r.row_key = i.key);
  if v_n > 0 then
    v_base := nextval('vms_private.row_seq');
    perform setval('vms_private.row_seq', (v_base + v_n + 2)::bigint);
    with marked as (
      select i.idx, i.key, i.vals, r.seq as cur_seq
        from vms_incoming i
        left join vms_private.rows r on r.tab = p_tab and r.deleted_at is null and r.row_key = i.key
    ), nb as (
      select m.*,
             max(cur_seq) over (order by idx rows between unbounded preceding and 1 preceding) as prev_seq,
             min(cur_seq) over (order by idx rows between 1 following and unbounded following) as next_seq
        from marked m
    ), news as (
      select nb.*,
             row_number() over (partition by prev_seq, next_seq order by idx) as rn,
             count(*) over (partition by prev_seq, next_seq) as cnt,
             row_number() over (order by idx) as gidx
        from nb where cur_seq is null
    )
    insert into vms_private.rows(tab, row_key, vals, seq)
    select p_tab, key, vals,
           case
             when next_seq is null or (prev_seq is not null and next_seq <= prev_seq) then v_base + gidx
             when prev_seq is null then next_seq - (cnt + 1 - rn)
             else prev_seq + (next_seq - prev_seq) * rn / (cnt + 1)
           end
      from news
    on conflict do nothing;
    get diagnostics v_ins = row_count;
  end if;

  -- 3. rows no longer in the Sheet
  if p_allow_delete then
    update vms_private.rows r set deleted_at = clock_timestamp()
     where r.tab = p_tab and r.deleted_at is null
       and not exists (select 1 from vms_incoming i where i.key = r.row_key)
       and not exists (select 1 from vms_protected p where p.id = r.id);
    get diagnostics v_del = row_count;
  end if;

  return jsonb_build_object('tab', p_tab, 'inserted', v_ins, 'updated', v_upd, 'deleted', v_del,
    'total', (select count(*) from vms_private.rows where tab = p_tab and deleted_at is null), 'now', now());
end $$;

-- A station reports its own upload queue (any signed-in user; always stored under their own email).
create or replace function public.vms_station_report(p_token text, p_report jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = vms_private, public as $$
declare u vms_private.sessions; v bigint;
begin
  u := vms_private.auth_session(p_token);
  if p_report is null or jsonb_typeof(p_report) <> 'object' then raise exception 'VMS_BAD_REQUEST: report must be an object'; end if;
  if octet_length(p_report::text) > 400000 then raise exception 'VMS_BAD_REQUEST: report too large'; end if;
  v := nextval('vms_private.station_seq');
  insert into vms_private.stations as s (email, name, report, reported_at, version)
  values (lower(u.email), coalesce(nullif(u.name, ''), u.email), p_report, clock_timestamp(), v)
  on conflict (email) do update set name = excluded.name, report = excluded.report,
    reported_at = excluded.reported_at, version = excluded.version;
  return jsonb_build_object('reportedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint, 'version', v);
end $$;

-- Administrators: every station's latest report. Cheap when nothing changed since p_since.
create or replace function public.vms_station_list(p_token text, p_since bigint default 0)
returns jsonb
language plpgsql stable security definer set search_path = vms_private, public as $$
declare u vms_private.sessions; v bigint; nowms bigint;
begin
  u := vms_private.auth_session(p_token);
  if not vms_private.is_admin(u.role) then raise exception 'VMS_FORBIDDEN: Administrator permission required.'; end if;
  nowms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  select coalesce(max(version), 0) into v from vms_private.stations where reported_at > now() - interval '6 hours';
  if v = coalesce(p_since, 0) then
    return jsonb_build_object('version', v, 'changed', false, 'serverTime', nowms);
  end if;
  return jsonb_build_object('version', v, 'changed', true, 'serverTime', nowms, 'stations', coalesce((
    select jsonb_agg(s.report || jsonb_build_object('email', s.email, 'name', s.name,
             'reportedAt', (extract(epoch from s.reported_at) * 1000)::bigint) order by s.email)
      from vms_private.stations s where s.reported_at > now() - interval '6 hours'), '[]'::jsonb));
end $$;

create or replace function public.vms_now()
returns timestamptz language sql stable as $$ select now() $$;

-- ------------------------------------------------------------------ permissions

do $$
declare f text;
begin
  -- Nobody gets a function by default ...
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'vms_private') and p.proname like any (array['vms\_%', 'rows\_%', 'token\_hash', 'is\_admin', 'auth\_session', 'can\_read', 'can\_write', 'row\_json', 'status\_json'])
  loop
    execute 'revoke all on function ' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function ' || f || ' from anon'; end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function ' || f || ' from authenticated'; end if;
  end loop;

  -- ... the web app (anon / publishable key) may call only the checked app functions ...
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.vms_pull(text, bigint, text[], bigint, uuid, int) to anon';
    execute 'grant execute on function public.vms_apply(text, jsonb) to anon';
    execute 'grant execute on function public.vms_whoami(text) to anon';
    execute 'grant execute on function public.vms_export(text, text, double precision, int) to anon';
    execute 'grant execute on function public.vms_status(text) to anon';
    execute 'grant execute on function public.vms_now() to anon';
    execute 'grant execute on function public.vms_station_report(text, jsonb) to anon';
    execute 'grant execute on function public.vms_station_list(text, bigint) to anon';
  end if;

  -- ... and Apps Script (service_role / secret key) gets the sync functions.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'vms\_%'
    loop
      execute 'grant execute on function ' || f || ' to service_role';
    end loop;
  end if;
end $$;

-- Let the API pick up the new functions straight away.
notify pgrst, 'reload schema';
