-- Passo 9: vacinas e vacinação em massa do plantel.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 08_copiar_ancestrais.sql. Pode rodar de novo sem problema.
--
-- O que muda:
--  * Cada usuário cadastra as vacinas que usa (tipo, marca e de quantos em quantos dias revacinar).
--  * "Iniciar vacinação" marca vários pombos de uma vez. Cada pombo vacinado ganha um registro
--    de Saúde no histórico (ex.: "Vacina Paramixovírus · Colombovac PMV").
--  * O app calcula a próxima dose de cada pombo e avisa quando estiver chegando.
--  * As vacinas e as datas são só de quem cadastrou. O registro no histórico é compartilhado,
--    como qualquer outro registro de saúde.
--  * Se o registro de vacina for apagado do histórico, a vacinação daquele pombo some junto.

do $$
begin
  if to_regclass('public.dados_pombo') is null then
    raise exception 'Rode primeiro o 06_seguranca_dados_por_usuario.sql.';
  end if;
end $$;

-- ---------- Vacinas de cada usuário ----------
create table if not exists public.vacinas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 80),
  marca text check (marca is null or length(marca) <= 80),
  intervalo_dias int check (intervalo_dias is null or intervalo_dias between 1 and 3650),
  observacoes text check (observacoes is null or length(observacoes) <= 500),
  criado_em timestamptz not null default now()
);
create index if not exists vacinas_user on public.vacinas (user_id);

alter table public.vacinas enable row level security;
drop policy if exists "vacinas: as minhas" on public.vacinas;
create policy "vacinas: as minhas" on public.vacinas
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.vacinas from anon, authenticated;
grant select, insert, update, delete on public.vacinas to authenticated;

-- Limite de 50 vacinas por usuário; o dono é sempre quem está logado.
create or replace function public.vacinas_preencher()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  if tg_op = 'INSERT' and (select count(*) from public.vacinas where user_id = new.user_id) >= 50 then
    raise exception 'Você chegou ao limite de 50 vacinas cadastradas.';
  end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.criado_em := old.criado_em; end if;
  new.nome := trim(new.nome);
  new.marca := nullif(trim(new.marca), '');
  new.observacoes := nullif(trim(new.observacoes), '');
  return new;
end $$;
drop trigger if exists vacinas_preencher on public.vacinas;
create trigger vacinas_preencher before insert or update on public.vacinas
  for each row execute function public.vacinas_preencher();

-- ---------- Vacinações (quem tomou qual vacina e quando) ----------
create table if not exists public.vacinacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  vacina_id uuid not null references public.vacinas (id) on delete cascade,
  pombo_id uuid not null references public.pombos (id) on delete cascade,
  data date not null,
  evento_id uuid references public.eventos (id) on delete cascade,
  criado_em timestamptz not null default now()
);
create index if not exists vacinacoes_user on public.vacinacoes (user_id, vacina_id, pombo_id, data);

alter table public.vacinacoes enable row level security;
drop policy if exists "vacinacoes: ver as minhas" on public.vacinacoes;
create policy "vacinacoes: ver as minhas" on public.vacinacoes
  for select to authenticated using (user_id = (select auth.uid()));
-- Só grava pela função abaixo.
revoke all on public.vacinacoes from anon, authenticated;
grant select on public.vacinacoes to authenticated;

-- Última dose de cada vacina em cada pombo do usuário (é o que o app carrega).
create or replace function public.minhas_vacinacoes()
returns table (vacina_id uuid, pombo_id uuid, ultima date, doses int)
language sql stable security definer set search_path = '' as $$
  select vc.vacina_id, vc.pombo_id, max(vc.data), count(*)::int
  from public.vacinacoes vc
  where vc.user_id = auth.uid()
  group by vc.vacina_id, vc.pombo_id
$$;

-- Vacina vários pombos de uma vez. Cada um ganha um registro de Saúde no histórico.
-- Só pombos que estão no plantel do usuário. Devolve quantos foram vacinados.
create or replace function public.registrar_vacinacao(p_vacina uuid, p_pombos uuid[], p_data date default current_date)
returns int language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v public.vacinas;
  x uuid;
  v_ev uuid;
  v_total int := 0;
  v_desc text;
begin
  if uid is null then raise exception 'Sua sessão expirou. Entre de novo.'; end if;
  select * into v from public.vacinas where id = p_vacina and user_id = uid;
  if not found then raise exception 'Vacina não encontrada.'; end if;
  if p_data is null or p_data > current_date + 1 or p_data < date '2000-01-01' then
    raise exception 'Data da vacinação inválida.';
  end if;
  if coalesce(array_length(p_pombos, 1), 0) = 0 then raise exception 'Marque pelo menos um pombo.'; end if;
  if array_length(p_pombos, 1) > 1000 then raise exception 'No máximo 1.000 pombos por vez.'; end if;
  v_desc := left('Vacina ' || v.nome || coalesce(' · ' || v.marca, ''), 2000);

  foreach x in array (select array_agg(distinct u) from unnest(p_pombos) u) loop
    if not public.tem_no_plantel(x) then continue; end if;
    -- Não repete a mesma vacina no mesmo pombo no mesmo dia.
    if exists (select 1 from public.vacinacoes where user_id = uid and vacina_id = v.id and pombo_id = x and data = p_data) then
      continue;
    end if;
    insert into public.eventos (pombo_id, autor_id, tipo, data, descricao)
    values (x, uid, 'saude', p_data, v_desc) returning id into v_ev;
    insert into public.vacinacoes (user_id, vacina_id, pombo_id, data, evento_id)
    values (uid, v.id, x, p_data, v_ev);
    v_total := v_total + 1;
  end loop;
  return v_total;
end $$;

revoke execute on function public.minhas_vacinacoes(), public.registrar_vacinacao(uuid, uuid[], date),
  public.vacinas_preencher() from public, anon;
grant execute on function public.minhas_vacinacoes(), public.registrar_vacinacao(uuid, uuid[], date) to authenticated;

-- Conferência: as três linhas devem dizer "ok".
select 'tabelas de vacina protegidas' as item,
       case when (select bool_and(relrowsecurity) from pg_class where oid in ('public.vacinas'::regclass, 'public.vacinacoes'::regclass))
             and not has_table_privilege('anon', 'public.vacinas', 'select')
             and not has_table_privilege('authenticated', 'public.vacinacoes', 'insert')
            then 'ok' else 'PROBLEMA' end as situacao
union all
select 'vacinação em massa instalada',
       case when has_function_privilege('authenticated', 'public.registrar_vacinacao(uuid, uuid[], date)', 'execute')
             and not has_function_privilege('anon', 'public.registrar_vacinacao(uuid, uuid[], date)', 'execute')
            then 'ok' else 'PROBLEMA' end
union all
select 'próximas doses instalada',
       case when has_function_privilege('authenticated', 'public.minhas_vacinacoes()', 'execute')
             and not has_function_privilege('anon', 'public.minhas_vacinacoes()', 'execute')
            then 'ok' else 'PROBLEMA' end;
