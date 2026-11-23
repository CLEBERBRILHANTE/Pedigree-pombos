-- Passo 11: tela Admin mostra quem usou a leitura com IA, quantas leituras cada um fez,
-- e quanto ainda resta do crédito da Anthropic, com aviso por e-mail quando estiver acabando.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 10_leitura_ia.sql. Pode rodar de novo sem problema.
-- Só o administrador consegue ver estas listas e mudar o saldo.
--
-- Saldo: começa com US$ 5,00 e aviso quando restar US$ 1,00. Quando colocar mais crédito na Anthropic,
-- digite o saldo novo na tela Admin (aba "Leituras com IA"): a conta recomeça dali.
-- O e-mail usa o mesmo aviso do 05_aviso_novo_cadastro.sql (Resend). Sem ele, o aviso aparece só na tela Admin.

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

-- ---------- Saldo do crédito da Anthropic ----------
create table if not exists public.config_ia (
  id int primary key default 1 check (id = 1),
  saldo numeric not null default 5,          -- saldo na Anthropic (US$) na data "desde"
  desde timestamptz,                         -- a partir de quando contar o gasto (vazio = desde o começo)
  avisar_quando_restar numeric not null default 1,
  alerta_enviado_em timestamptz
);
insert into public.config_ia (id) values (1) on conflict do nothing;
alter table public.config_ia enable row level security;
revoke all on public.config_ia from anon, authenticated;

-- Quanto foi gasto desde a última atualização do saldo e quanto resta.
create or replace function public.saldo_ia()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'saldo', c.saldo, 'desde', c.desde, 'avisar_quando_restar', c.avisar_quando_restar,
    'alerta_enviado_em', c.alerta_enviado_em, 'gasto', g.gasto, 'resta', c.saldo - g.gasto,
    'acabando', c.saldo - g.gasto <= c.avisar_quando_restar)
  from public.config_ia c,
  lateral (select coalesce(sum(public.custo_leitura_ia(l.modelo, l.tokens_entrada, l.tokens_saida)), 0) as gasto
           from public.leituras_ia l where l.situacao = 'ok' and (c.desde is null or l.criado_em >= c.desde)) g
  where c.id = 1
$$;

create or replace function public.admin_saldo_ia()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.exigir_admin();
  return public.saldo_ia();
end $$;

-- O administrador digita o saldo que aparece no site da Anthropic (ex.: depois de colocar mais crédito).
create or replace function public.admin_definir_saldo_ia(p_saldo numeric, p_avisar numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.exigir_admin();
  if p_saldo is null or p_saldo < 0 or p_saldo > 10000 then raise exception 'Saldo inválido.'; end if;
  if p_avisar is not null and (p_avisar < 0 or p_avisar > 10000) then raise exception 'Valor do aviso inválido.'; end if;
  update public.config_ia set saldo = p_saldo, desde = now(), alerta_enviado_em = null,
    avisar_quando_restar = coalesce(p_avisar, avisar_quando_restar) where id = 1;
  return public.saldo_ia();
end $$;

-- Depois de cada leitura: se o saldo estiver acabando, manda um e-mail (uma vez até o saldo ser atualizado).
create or replace function public.conferir_saldo_ia()
returns void language plpgsql security definer set search_path = '' as $$
declare s jsonb;
begin
  s := public.saldo_ia();
  if not (s ->> 'acabando')::boolean or (s ->> 'alerta_enviado_em') is not null then return; end if;
  update public.config_ia set alerta_enviado_em = now() where id = 1;
  begin
    perform public.enviar_aviso_email(
      'Pedigree Grátis: o crédito da leitura com IA está acabando',
      '<p><b>O crédito da Anthropic (leitura de pedigree com IA) está acabando.</b></p>'
      || '<p>Saldo aproximado: US$ ' || to_char(greatest((s ->> 'resta')::numeric, 0), 'FM9990.00')
      || ' (gasto desde a última atualização: US$ ' || to_char((s ->> 'gasto')::numeric, 'FM9990.00') || ').</p>'
      || '<p>Para continuar, coloque mais crédito em <a href="https://console.anthropic.com/settings/billing">console.anthropic.com</a> '
      || 'e depois digite o saldo novo na <a href="https://pedigreegratis.vercel.app/#/admin">tela Admin</a>, aba "Leituras com IA".</p>');
  exception when others then
    null; -- sem o aviso por e-mail configurado, fica só o alerta na tela Admin
  end;
end $$;

-- Mesma função do 10_leitura_ia.sql, agora conferindo o saldo depois de cada leitura.
create or replace function public.concluir_leitura_ia(p_leitura uuid, p_ok boolean, p_modelo text default null,
  p_entrada int default null, p_saida int default null, p_pombos int default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.leituras_ia set situacao = 'ok', modelo = left(p_modelo, 60),
      tokens_entrada = p_entrada, tokens_saida = p_saida, pombos = p_pombos
    where id = p_leitura and user_id = auth.uid() and situacao = 'pendente';
    if found then
      begin perform public.conferir_saldo_ia(); exception when others then null; end;
    end if;
  else
    delete from public.leituras_ia
    where id = p_leitura and user_id = auth.uid() and situacao = 'pendente' and criado_em > now() - interval '5 minutes';
  end if;
end $$;

revoke execute on function public.saldo_ia(), public.conferir_saldo_ia() from public, anon, authenticated;
revoke execute on function public.admin_saldo_ia(), public.admin_definir_saldo_ia(numeric, numeric) from public, anon;
grant execute on function public.admin_saldo_ia(), public.admin_definir_saldo_ia(numeric, numeric) to authenticated;

revoke execute on function public.admin_leituras_ia_usuarios(), public.admin_leituras_ia_recentes(int) from public, anon;
grant execute on function public.admin_leituras_ia_usuarios(), public.admin_leituras_ia_recentes(int) to authenticated;

-- Conferência: as duas linhas devem dizer "ok".
select 'leituras por usuário instaladas' as item,
       case when to_regprocedure('public.admin_leituras_ia_usuarios()') is not null
             and not has_function_privilege('anon', 'public.admin_leituras_ia_usuarios()', 'execute')
            then 'ok' else 'PROBLEMA' end as situacao
union all
select 'saldo e aviso do crédito',
       case when to_regclass('public.config_ia') is not null
             and not has_function_privilege('authenticated', 'public.conferir_saldo_ia()', 'execute')
             and not has_table_privilege('authenticated', 'public.config_ia', 'select')
            then 'ok' else 'PROBLEMA' end;
