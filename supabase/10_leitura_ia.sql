-- Passo 10: leitura de pedigree por foto ou PDF com inteligência artificial (IA).
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 09_vacinas.sql. Pode rodar de novo sem problema.
--
-- O que muda:
--  * Guarda quantas leituras com IA cada usuário fez, para controlar o custo.
--  * Limite por usuário: 5 leituras por dia e 30 por mês. O administrador não tem limite.
--    Para mudar, troque os números em "limites_leitura_ia" abaixo e rode este arquivo de novo.
--  * Ninguém consegue ver nem apagar a contagem pelo app: só o servidor do app (Vercel) registra
--    as leituras, em nome do usuário que está logado.
--  * O administrador vê na tela Admin quantas leituras foram feitas e o custo aproximado.

do $$
begin
  if to_regclass('public.administradores') is null then
    raise exception 'Rode primeiro o 04_admin.sql.';
  end if;
end $$;

create table if not exists public.leituras_ia (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now(),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'ok')),
  modelo text,
  tokens_entrada int,
  tokens_saida int,
  pombos int
);
create index if not exists leituras_ia_user on public.leituras_ia (user_id, criado_em);

alter table public.leituras_ia enable row level security;
-- Sem nenhuma regra de acesso: o app não lê nem altera esta tabela, só as funções abaixo.
revoke all on public.leituras_ia from anon, authenticated;

-- Limites por usuário (troque os números aqui).
create or replace function public.limites_leitura_ia()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('dia', 5, 'mes', 30)
$$;

-- Quantas leituras o usuário logado já fez hoje e neste mês (horário de Brasília).
create or replace function public.minhas_leituras_ia()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  lim jsonb := public.limites_leitura_ia();
  v_dia int; v_mes int;
begin
  if uid is null then raise exception 'Sua sessão expirou. Entre de novo.'; end if;
  select count(*) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = hoje),
         count(*) filter (where date_trunc('month', criado_em at time zone 'America/Sao_Paulo') = date_trunc('month', hoje::timestamp))
    into v_dia, v_mes
    from public.leituras_ia
    where user_id = uid and criado_em > now() - interval '32 days';
  return jsonb_build_object(
    'admin', public.sou_admin(),
    'hoje', v_dia, 'mes', v_mes,
    'limite_dia', (lim ->> 'dia')::int, 'limite_mes', (lim ->> 'mes')::int);
end $$;

-- O servidor chama antes de ler: confere o limite e já conta a leitura.
-- Devolve o número da leitura (só o servidor recebe) para ele confirmar ou devolver depois.
create or replace function public.iniciar_leitura_ia()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  m jsonb;
  v_id uuid;
begin
  if uid is null then raise exception 'Sua sessão expirou. Entre de novo.'; end if;
  -- Uma leitura por vez para cada usuário.
  perform pg_advisory_xact_lock(hashtext('leitura_ia:' || uid::text));
  m := public.minhas_leituras_ia();
  if not (m ->> 'admin')::boolean then
    if (m ->> 'hoje')::int >= (m ->> 'limite_dia')::int then
      raise exception 'Você já usou as % leituras de hoje. Amanhã tem mais.', m ->> 'limite_dia';
    end if;
    if (m ->> 'mes')::int >= (m ->> 'limite_mes')::int then
      raise exception 'Você já usou as % leituras deste mês. No mês que vem tem mais.', m ->> 'limite_mes';
    end if;
  end if;
  insert into public.leituras_ia (user_id) values (uid) returning id into v_id;
  return m || jsonb_build_object('leitura', v_id);
end $$;

-- O servidor chama depois de ler.
-- Deu certo: guarda o modelo e os tokens (para calcular o custo).
-- Deu errado: devolve a leitura ao usuário (só se ainda estiver pendente e for recente).
create or replace function public.concluir_leitura_ia(p_leitura uuid, p_ok boolean, p_modelo text default null,
  p_entrada int default null, p_saida int default null, p_pombos int default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.leituras_ia set situacao = 'ok', modelo = left(p_modelo, 60),
      tokens_entrada = p_entrada, tokens_saida = p_saida, pombos = p_pombos
    where id = p_leitura and user_id = auth.uid() and situacao = 'pendente';
  else
    delete from public.leituras_ia
    where id = p_leitura and user_id = auth.uid() and situacao = 'pendente' and criado_em > now() - interval '5 minutes';
  end if;
end $$;

-- Tela Admin: leituras e custo aproximado em dólar (preço por milhão de tokens: entrada / saída).
create or replace function public.admin_leituras_ia()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.exigir_admin();
  with l as (
    select *, case
      when modelo like 'claude-haiku%' then (coalesce(tokens_entrada, 0) * 0.10 + coalesce(tokens_saida, 0) * 0.50) / 1e6
      when modelo like 'claude-sonnet%' then (coalesce(tokens_entrada, 0) * 2.0 + coalesce(tokens_saida, 0) * 10.0) / 1e6
      else (coalesce(tokens_entrada, 0) * 4.0 + coalesce(tokens_saida, 0) * 20.0) / 1e6 end as custo
    from public.leituras_ia where situacao = 'ok'
  )
  select jsonb_build_object(
    'total', (select count(*) from l),
    'mes', (select count(*) from l where date_trunc('month', criado_em at time zone 'America/Sao_Paulo') = date_trunc('month', now() at time zone 'America/Sao_Paulo')),
    'usuarios_mes', (select count(distinct user_id) from l where date_trunc('month', criado_em at time zone 'America/Sao_Paulo') = date_trunc('month', now() at time zone 'America/Sao_Paulo')),
    'custo_total', (select coalesce(sum(custo), 0) from l),
    'custo_mes', (select coalesce(sum(custo), 0) from l where date_trunc('month', criado_em at time zone 'America/Sao_Paulo') = date_trunc('month', now() at time zone 'America/Sao_Paulo'))
  ) into r;
  return r;
end $$;

revoke execute on function public.minhas_leituras_ia(), public.iniciar_leitura_ia(),
  public.concluir_leitura_ia(uuid, boolean, text, int, int, int), public.admin_leituras_ia() from public, anon;
grant execute on function public.minhas_leituras_ia(), public.iniciar_leitura_ia(),
  public.concluir_leitura_ia(uuid, boolean, text, int, int, int), public.admin_leituras_ia() to authenticated;

-- Conferência: as duas linhas devem dizer "ok".
select 'leitura com IA instalada' as item,
       case when to_regprocedure('public.iniciar_leitura_ia()') is not null
             and has_function_privilege('authenticated', 'public.iniciar_leitura_ia()', 'execute')
             and not has_function_privilege('anon', 'public.iniciar_leitura_ia()', 'execute')
            then 'ok' else 'PROBLEMA' end as situacao
union all
select 'contagem protegida',
       case when not has_table_privilege('authenticated', 'public.leituras_ia', 'select')
             and not has_table_privilege('authenticated', 'public.leituras_ia', 'delete')
            then 'ok' else 'PROBLEMA' end;
