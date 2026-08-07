-- Schema de referencia para la sincronizacion publica/administrador.
create table if not exists public.portfolio_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.portfolio_state enable row level security;

create policy "Public portfolio read access"
on public.portfolio_state for select
to anon, authenticated
using (true);

create policy "Admin portfolio insert access"
on public.portfolio_state for insert
to authenticated
with check (((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

create policy "Admin portfolio update access"
on public.portfolio_state for update
to authenticated
using (((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com')
with check (((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

create index if not exists portfolio_state_updated_by_idx
on public.portfolio_state(updated_by);

insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy "Admin document read access"
on storage.objects for select
to authenticated
using (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

create policy "Admin document insert access"
on storage.objects for insert
to authenticated
with check (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

create policy "Admin document update access"
on storage.objects for update
to authenticated
using (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com')
with check (bucket_id = 'documentos' and ((select auth.jwt()) ->> 'email') = 'fpardo1996@gmail.com');

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
