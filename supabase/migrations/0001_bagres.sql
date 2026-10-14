-- Execute no SQL Editor de um projeto Supabase separado da hospedagem OpenAI.
begin;
create table if not exists public.site_state (
 id integer primary key check (id = 1),
 data text not null check (jsonb_typeof(data::jsonb) = 'object'),
 version bigint not null default 1 check (version >= 1)
);
create table if not exists public.admin_attempts (
 client_key text primary key,
 failures integer not null default 0,
 locked_until bigint not null default 0
);
alter table public.site_state enable row level security;
alter table public.admin_attempts enable row level security;
revoke all on public.site_state, public.admin_attempts from anon, authenticated;
grant select, insert, update, delete on public.site_state, public.admin_attempts to service_role;

-- Atomic compare-and-swap: a stale device cannot overwrite newer results.
create or replace function public.save_site_state(p_data text, p_expected_version bigint)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare saved_version bigint;
begin
 if p_expected_version < 0 or p_data is null or octet_length(p_data) > 4000000 then
  raise exception 'Invalid state';
 end if;
 if p_expected_version = 0 then
  insert into public.site_state(id,data,version) values(1,p_data,1)
  on conflict(id) do nothing returning version into saved_version;
 else
  update public.site_state set data=p_data,version=version+1
  where id=1 and version=p_expected_version returning version into saved_version;
 end if;
 return coalesce(saved_version,0);
end;
$$;
revoke all on function public.save_site_state(text,bigint) from public, anon, authenticated;
grant execute on function public.save_site_state(text,bigint) to service_role;

-- Private bucket: uploads/downloads go through the server, never an anonymous key.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bagres-player-photos','bagres-player-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
commit;
