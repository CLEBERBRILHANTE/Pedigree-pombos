-- Passo 12: logo do pombal (aparece no topo dos pedigrees em PDF).
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 06_seguranca_dados_por_usuario.sql. Pode rodar de novo sem problema.
--
-- O que muda:
--  * Em "Meu pombal" dá para escolher uma foto como logo do pombal (e trocar ou remover).
--  * A logo fica na pasta privada de fotos, dentro da pasta do próprio usuário.
--  * Só o dono vê e troca a própria logo. Ela sai impressa nos pedigrees que ele emitir.

do $$
begin
  if to_regclass('public.dados_pombo') is null then
    raise exception 'Rode primeiro o 06_seguranca_dados_por_usuario.sql.';
  end if;
end $$;

-- Onde está a logo de cada pombal (sempre na pasta do próprio usuário: <id>/logo/...).
alter table public.perfis add column if not exists logo text;
alter table public.perfis drop constraint if exists perfis_logo;
alter table public.perfis add constraint perfis_logo check (
  logo is null or (length(logo) <= 200 and logo like id::text || '/logo/%' and logo !~ '\.\.'));

-- Quantos arquivos de logo o usuário tem (o app apaga a logo antiga ao trocar).
create or replace function public.minhas_logos_total()
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from storage.objects
  where bucket_id = 'fotos' and split_part(name, '/', 1) = auth.uid()::text and split_part(name, '/', 2) = 'logo'
$$;
revoke execute on function public.minhas_logos_total() from public, anon;
grant execute on function public.minhas_logos_total() to authenticated;

-- Enviar a logo: só na própria pasta, no máximo 5 arquivos de logo guardados.
drop policy if exists "fotos: enviar logo" on storage.objects;
create policy "fotos: enviar logo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and split_part(name, '/', 2) = 'logo'
    and public.minhas_logos_total() < 5);
-- Ver, trocar e apagar já valem para tudo dentro da pasta do próprio usuário (passo 06).

-- Conferência: as duas linhas devem dizer "ok".
select 'logo do pombal instalada' as item,
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'perfis' and column_name = 'logo')
             and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'fotos: enviar logo')
            then 'ok' else 'PROBLEMA' end as situacao
union all
select 'logo só do dono',
       case when not has_function_privilege('anon', 'public.minhas_logos_total()', 'execute')
             and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'perfis'
                             and 'anon' = any(roles))
            then 'ok' else 'PROBLEMA' end;
