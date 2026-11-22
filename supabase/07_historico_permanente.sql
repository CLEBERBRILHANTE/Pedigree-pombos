-- Passo 7: o histórico do pombo não se apaga quando ele sai do plantel.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 06_seguranca_dados_por_usuario.sql. Pode rodar de novo sem problema.
--
-- O que muda:
--  * "Tirar do meu plantel" não apaga mais nada do histórico: provas, prêmios, saúde,
--    reprodução, observações, entradas e saídas continuam guardados na anilha.
--    (Os dados particulares do pombo e as fotos saem, como antes.)
--  * Depois que o pombo sai do seu plantel, os registros que você fez no histórico dele
--    ficam guardados: não dá mais para alterar nem apagar. Enquanto ele estiver no plantel
--    (inclusive como vendido, cedido, perdido ou morto), você ainda corrige ou apaga os seus.

do $$
begin
  if to_regclass('public.dados_pombo') is null then
    raise exception 'Rode primeiro o 06_seguranca_dados_por_usuario.sql.';
  end if;
end $$;

-- Tira o pombo do meu plantel sem apagar nada do histórico.
-- O segundo valor existe só para o app antigo continuar funcionando; ele é ignorado.
-- Devolve as fotos que o app deve apagar (só da pasta do próprio usuário).
create or replace function public.remover_do_plantel(p_plantel uuid, p_apagar_registros boolean default false)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_pl public.plantel;
  v_fotos text[] := '{}';
begin
  select * into v_pl from public.plantel where id = p_plantel and user_id = auth.uid();
  if not found then raise exception 'Este pombo não está no seu plantel.'; end if;
  delete from public.plantel where id = v_pl.id;
  -- Se ele não é pai/mãe de nenhum pombo meu, meus dados dele saem também.
  if not exists (select 1 from public.dados_pombo where user_id = auth.uid() and (pai_id = v_pl.pombo_id or mae_id = v_pl.pombo_id)) then
    select array_remove(array[foto_olho, foto_cabeca], null) into v_fotos
      from public.dados_pombo where user_id = auth.uid() and pombo_id = v_pl.pombo_id;
    delete from public.dados_pombo where user_id = auth.uid() and pombo_id = v_pl.pombo_id;
  end if;
  perform public.apagar_se_orfao(v_pl.pombo_id);
  return array(select f from unnest(coalesce(v_fotos, '{}')) f where split_part(f, '/', 1) = auth.uid()::text);
end $$;

revoke execute on function public.remover_do_plantel(uuid, boolean) from public, anon;
grant execute on function public.remover_do_plantel(uuid, boolean) to authenticated;

-- Só apaga um registro seu se o pombo ainda estiver no seu plantel.
drop policy if exists "eventos: apagar os meus" on public.eventos;
create policy "eventos: apagar os meus" on public.eventos
  for delete to authenticated
  using (autor_id = (select auth.uid()) and tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao')
         and public.tem_no_plantel(pombo_id));

-- Conferência: as duas linhas devem dizer "ok".
select 'tirar do plantel guarda o histórico' as item,
       case when pg_get_functiondef('public.remover_do_plantel(uuid, boolean)'::regprocedure) !~* 'delete\s+from\s+public\.eventos'
            then 'ok' else 'PROBLEMA' end as situacao
union all
select 'apagar registro só com o pombo no plantel',
       case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'eventos'
                           and policyname = 'eventos: apagar os meus' and qual ilike '%tem_no_plantel%')
            then 'ok' else 'PROBLEMA' end;
