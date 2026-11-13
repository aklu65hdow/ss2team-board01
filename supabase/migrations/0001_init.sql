-- Командная доска: схема базы данных.
-- Выполнить один раз: Supabase → SQL Editor → вставить весь файл → Run.

-- ===== Профили и доступ =====
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  name        text,
  avatar_url  text,
  status      text not null default 'pending' check (status in ('pending','approved','blocked')),
  role        text not null default 'buyer'   check (role in ('admin','buyer','viewer')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid
);

-- Новый пользователь попадает в заявки. Самый первый вошедший становится администратором.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, name, avatar_url, status, role, approved_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'picture', new.raw_user_meta_data->>'avatar_url'),
    case when is_first then 'approved' else 'pending' end,
    case when is_first then 'admin' else 'buyer' end,
    case when is_first then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'approved'
$$;
create or replace function public.is_member() returns boolean
language sql stable as $$ select public.my_role() is not null $$;
create or replace function public.is_admin() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'admin', false) $$;
create or replace function public.can_write() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('admin','buyer'), false) $$;

alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin() or (public.is_member() and status = 'approved'));
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

-- ===== Данные доски =====
-- Документы хранятся по путям: hubs/<id>, tasks/<id>, tests/<id>/comments/<id>, ideas/<id>, calls/<id>, settings/access.
create table if not exists public.docs (
  path        text primary key,
  coll        text not null,
  doc_id      text not null,
  data        jsonb not null default '{}'::jsonb,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists docs_coll_idx on public.docs (coll);

alter table public.docs enable row level security;
drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select using (public.is_member());
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert
  with check (public.can_write() and (coll <> 'settings' or public.is_admin()));
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update
  using (public.can_write() and (coll <> 'settings' or public.is_admin()))
  with check (public.can_write() and (coll <> 'settings' or public.is_admin()));
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete
  using (public.can_write() and (coll <> 'settings' or public.is_admin()));

-- Частичное обновление документа одним запросом (права проверяются политиками выше).
create or replace function public.doc_merge(p_path text, p_patch jsonb) returns void
language sql security invoker set search_path = public as $$
  update public.docs set data = data || p_patch, updated_at = now() where path = p_path
$$;

-- ===== Журнал действий =====
create table if not exists public.logs (
  id      bigserial primary key,
  actor   uuid not null default auth.uid(),
  action  text not null,
  target  text,
  at      timestamptz not null default now()
);
create index if not exists logs_at_idx on public.logs (at desc);
alter table public.logs enable row level security;
drop policy if exists logs_insert on public.logs;
create policy logs_insert on public.logs for insert with check (public.is_member() and actor = auth.uid());
drop policy if exists logs_read on public.logs;
create policy logs_read on public.logs for select using (public.is_admin());

-- ===== Живые обновления =====
do $$ begin
  begin alter publication supabase_realtime add table public.docs;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
end $$;

-- ===== Хранилище записей созвонов (приватное, до 50 МБ на файл) =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('recordings', 'recordings', false, 52428800)
on conflict (id) do nothing;

drop policy if exists recordings_read on storage.objects;
create policy recordings_read on storage.objects for select
  using (bucket_id = 'recordings' and public.is_member());
drop policy if exists recordings_write on storage.objects;
create policy recordings_write on storage.objects for insert
  with check (bucket_id = 'recordings' and public.can_write());
drop policy if exists recordings_delete on storage.objects;
create policy recordings_delete on storage.objects for delete
  using (bucket_id = 'recordings' and public.can_write());
