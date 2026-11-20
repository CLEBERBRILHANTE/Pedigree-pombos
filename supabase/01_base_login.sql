-- Passo 1: base do app (perfil de cada usuário).
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Pode rodar de novo sem problema.

-- Dados do pombal de cada usuário (aparecem no cabeçalho do pedigree).
create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text,
  nome_pombal text,
  cidade text,
  email_contato text,
  telefone text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Segurança: cada pessoa só enxerga e altera o próprio perfil.
alter table public.perfis enable row level security;

drop policy if exists "perfis: ver o próprio" on public.perfis;
create policy "perfis: ver o próprio" on public.perfis
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "perfis: criar o próprio" on public.perfis;
create policy "perfis: criar o próprio" on public.perfis
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "perfis: alterar o próprio" on public.perfis;
create policy "perfis: alterar o próprio" on public.perfis
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

grant select, insert, update on public.perfis to authenticated;

-- Atualiza a data de alteração automaticamente.
create or replace function public.tocar_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists perfis_atualizado_em on public.perfis;
create trigger perfis_atualizado_em before update on public.perfis
  for each row execute function public.tocar_atualizado_em();

-- Cria o perfil automaticamente quando alguém cria a conta.
create or replace function public.criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (id, nome, nome_pombal, email_contato)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nome',
    new.raw_user_meta_data ->> 'nome_pombal',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();
