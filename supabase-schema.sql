-- Esquema idempotente para sincronización pública y administración privada.
-- Puede ejecutarse nuevamente sin duplicar políticas ni perder información.

create table if not exists public.portfolio_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.portfolio_state enable row level security;

-- La aplicación ofrece una vista pública de solo lectura. Para hacer todo el
-- panel privado, elimina anon de este GRANT y de la política de lectura.
grant select on table public.portfolio_state to anon;
grant select, insert, update on table public.portfolio_state to authenticated;

drop policy if exists "Public portfolio read access" on public.portfolio_state;
create policy "Public portfolio read access"
on public.portfolio_state for select
to anon, authenticated
using (true);

drop policy if exists "Admin portfolio insert access" on public.portfolio_state;
create policy "Admin portfolio insert access"
on public.portfolio_state for insert
to authenticated
with check (((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

drop policy if exists "Admin portfolio update access" on public.portfolio_state;
create policy "Admin portfolio update access"
on public.portfolio_state for update
to authenticated
using (((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com')
with check (((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

create index if not exists portfolio_state_updated_by_idx
on public.portfolio_state(updated_by);

-- La aplicación actualiza esta fila. Sin ella, UPDATE afectaría cero registros.
insert into public.portfolio_state (id, data)
values ('main', jsonb_build_object(
  'properties', '[]'::jsonb,
  'mortgages', '[]'::jsonb,
  'income', '[]'::jsonb,
  'expenses', '[]'::jsonb
))
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Admin document read access" on storage.objects;
create policy "Admin document read access"
on storage.objects for select
to authenticated
using (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

drop policy if exists "Admin document insert access" on storage.objects;
create policy "Admin document insert access"
on storage.objects for insert
to authenticated
with check (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

drop policy if exists "Admin document update access" on storage.objects;
create policy "Admin document update access"
on storage.objects for update
to authenticated
using (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com')
with check (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

drop policy if exists "Admin document delete access" on storage.objects;
create policy "Admin document delete access"
on storage.objects for delete
to authenticated
using (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

do $$
begin
  alter publication supabase_realtime add table public.portfolio_state;
exception
  when duplicate_object then null;
end
$$;
