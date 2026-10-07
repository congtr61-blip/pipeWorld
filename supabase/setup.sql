create table if not exists public.inquiries (
  id text primary key,
  name text not null,
  email text not null,
  phone text,
  type text not null,
  subject text,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.inquiries
  add column if not exists status text not null default 'new',
  add column if not exists admin_notes text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.inquiries enable row level security;
revoke all on public.inquiries from anon, authenticated;

create table if not exists public.contact_rate_limits (
  rate_limit_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

alter table public.contact_rate_limits enable row level security;
revoke all on public.contact_rate_limits from anon, authenticated;

create or replace function public.check_contact_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_key is null or p_key = '' or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid contact rate limit arguments';
  end if;

  insert into public.contact_rate_limits as current_limit (
    rate_limit_key,
    window_started_at,
    request_count
  )
  values (p_key, now(), 1)
  on conflict (rate_limit_key) do update
    set window_started_at = case
          when current_limit.window_started_at
            + make_interval(secs => p_window_seconds) <= now()
          then now()
          else current_limit.window_started_at
        end,
        request_count = case
          when current_limit.window_started_at
            + make_interval(secs => p_window_seconds) <= now()
          then 1
          else least(current_limit.request_count + 1, p_limit + 1)
        end
  returning current_limit.window_started_at, current_limit.request_count
  into v_window_started_at, v_request_count;

  if random() < 0.01 then
    delete from public.contact_rate_limits
    where window_started_at < now() - interval '1 day';
  end if;

  return query
    select
      v_request_count <= p_limit,
      greatest(
        1,
        ceil(extract(epoch from (
          v_window_started_at + make_interval(secs => p_window_seconds) - now()
        )))::integer
      );
end;
$$;

revoke all on function public.check_contact_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_contact_rate_limit(text, integer, integer)
  to service_role;
