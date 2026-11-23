-- Passo 11: tela Admin mostra quem usou a leitura com IA e quantas leituras cada um fez.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 10_leitura_ia.sql. Pode rodar de novo sem problema.
-- Só o administrador consegue ver estas listas.

do $$
begin
  if to_regclass('public.leituras_ia') is null then
    raise exception 'Rode primeiro o 10_leitura_ia.sql.';
  end if;
end $$;

-- Custo aproximado de uma leitura em dólar (preço por milhão de tokens: entrada / saída).
create or replace function public.custo_leitura_ia(p_modelo text, p_entrada int, p_saida int)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when p_modelo like 'claude-haiku%' then (coalesce(p_entrada, 0) * 0.10 + coalesce(p_saida, 0) * 0.50) / 1e6
    when p_modelo like 'claude-sonnet%' then (coalesce(p_entrada, 0) * 2.0 + coalesce(p_saida, 0) * 10.0) / 1e6
    else (coalesce(p_entrada, 0) * 4.0 + coalesce(p_saida, 0) * 20.0) / 1e6 end
$$;

-- Leituras de cada usuário (total, neste mês, custo e a última).
create or replace function public.admin_leituras_ia_usuarios()
returns table (user_id uuid, email text, nome text, nome_pombal text, total bigint, mes bigint,
               pombos bigint, custo_total numeric, custo_mes numeric, ultima timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare inicio_mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  perform public.exigir_admin();
  return query
  select l.user_id, u.email::text, p.nome, p.nome_pombal,
         count(*), count(*) filter (where l.criado_em >= inicio_mes),
         coalesce(sum(l.pombos), 0)::bigint,
         sum(public.custo_leitura_ia(l.modelo, l.tokens_entrada, l.tokens_saida)),
         coalesce(sum(public.custo_leitura_ia(l.modelo, l.tokens_entrada, l.tokens_saida)) filter (where l.criado_em >= inicio_mes), 0),
         max(l.criado_em)
  from public.leituras_ia l
  join auth.users u on u.id = l.user_id
  left join public.perfis p on p.id = l.user_id
  where l.situacao = 'ok'
  group by l.user_id, u.email, p.nome, p.nome_pombal
  order by max(l.criado_em) desc;
end $$;

-- As últimas leituras (quem, quando, modelo, quantos pombos e custo).
create or replace function public.admin_leituras_ia_recentes(p_limite int default 50)
returns table (criado_em timestamptz, user_id uuid, email text, nome_pombal text, modelo text, pombos int, custo numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.exigir_admin();
  return query
  select l.criado_em, l.user_id, u.email::text, p.nome_pombal, l.modelo, l.pombos,
         public.custo_leitura_ia(l.modelo, l.tokens_entrada, l.tokens_saida)
  from public.leituras_ia l
  join auth.users u on u.id = l.user_id
  left join public.perfis p on p.id = l.user_id
  where l.situacao = 'ok'
  order by l.criado_em desc
  limit least(greatest(coalesce(p_limite, 50), 1), 500);
end $$;

revoke execute on function public.admin_leituras_ia_usuarios(), public.admin_leituras_ia_recentes(int) from public, anon;
grant execute on function public.admin_leituras_ia_usuarios(), public.admin_leituras_ia_recentes(int) to authenticated;

-- Conferência: a linha deve dizer "ok".
select 'leituras por usuário instaladas' as item,
       case when to_regprocedure('public.admin_leituras_ia_usuarios()') is not null
             and not has_function_privilege('anon', 'public.admin_leituras_ia_usuarios()', 'execute')
            then 'ok' else 'PROBLEMA' end as situacao;
