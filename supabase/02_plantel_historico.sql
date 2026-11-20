-- Passo 2: plantel de pombos + histórico compartilhado de cada pombo.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 01_base_login.sql. Pode rodar de novo sem problema.
--
-- Como funciona:
--  * pombos  = o pombo em si, único no app todo, identificado pela anilha (país + ano + número).
--              Nome, sexo, cor, nascimento, pai e mãe ficam aqui.
--  * plantel = a passagem do pombo pelo pombal de cada usuário (situação, origem, datas e
--              observações). É particular: cada um só vê o próprio plantel.
--  * eventos = o histórico do pombo (provas e resultados, prêmios, saúde, reprodução,
--              observações, entradas e saídas de pombal, alterações de dados).
--              Todos que têm ou tiveram o pombo no plantel veem o histórico inteiro.
--
-- Regras:
--  * Quem cadastra uma anilha que já existe no app passa a ver o histórico dela.
--  * Só quem está com o pombo (situação "no pombal") pode mudar nome, sexo, cor,
--    nascimento, pai e mãe. Se ninguém está com ele, qualquer um que o tenha no plantel pode.
--    Campos em branco qualquer um que o tenha no plantel pode completar.
--    Toda alteração desses dados fica registrada no histórico, com o nome do pombal.
--  * Cada registro do histórico só pode ser alterado ou apagado por quem o fez.
--    Entradas, saídas e alterações são automáticas e ninguém edita.

-- ---------- Funções de apoio da anilha ----------

-- Número da anilha "limpo" para comparar: só letras e números, sem zeros à esquerda.
-- Assim "00507-929" e "507929" são a mesma anilha.
create or replace function public.anilha_numero_norm(n text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(ltrim(regexp_replace(upper(coalesce(n, '')), '[^0-9A-Z]', '', 'g'), '0'), ''), '0')
$$;

-- Ano com 4 dígitos (23 -> 2023, 98 -> 1998).
create or replace function public.anilha_ano4(a int)
returns int language sql stable set search_path = '' as $$
  select case
    when a is null then null
    when a >= 1900 then a
    when a between 0 and 99 then a + case when a <= (extract(year from now())::int % 100) + 1 then 2000 else 1900 end
    else null end
$$;

-- Anilha escrita como no pedigree: 1402317/23 BRA
create or replace function public.anilha_texto(p_pais text, p_ano int, p_numero text)
returns text language sql immutable set search_path = '' as $$
  select p_numero || '/' || lpad((p_ano % 100)::text, 2, '0') || ' ' || p_pais
$$;

-- ---------- Tabelas ----------

create table if not exists public.pombos (
  id uuid primary key default gen_random_uuid(),
  pais text not null check (pais ~ '^[A-Z]{2,4}$'),
  ano smallint not null check (ano between 1900 and 2100),
  numero text not null check (length(trim(numero)) between 1 and 30),
  nome text,
  sexo text check (sexo in ('M', 'F')),
  cor text,
  nascimento date,
  pai_id uuid references public.pombos (id) on delete set null,
  mae_id uuid references public.pombos (id) on delete set null,
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint pombos_nao_e_pai_de_si check (pai_id is distinct from id and mae_id is distinct from id)
);
create unique index if not exists pombos_anilha_unica on public.pombos (pais, ano, public.anilha_numero_norm(numero));
create index if not exists pombos_pai on public.pombos (pai_id);
create index if not exists pombos_mae on public.pombos (mae_id);

create table if not exists public.plantel (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pombo_id uuid not null references public.pombos (id) on delete cascade,
  -- ativo = no meu pombal; referencia = ancestral, só para o pedigree
  situacao text not null default 'ativo' check (situacao in ('ativo', 'referencia', 'vendido', 'cedido', 'perdido', 'morto')),
  origem text check (origem in ('nascido', 'comprado', 'ganho', 'emprestado', 'outro')),
  origem_obs text,
  data_entrada date,
  data_saida date,
  saida_obs text,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (user_id, pombo_id)
);
create index if not exists plantel_pombo on public.plantel (pombo_id);

create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  pombo_id uuid not null references public.pombos (id) on delete cascade,
  autor_id uuid default auth.uid() references auth.users (id) on delete set null,
  autor_pombal text,
  tipo text not null check (tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao', 'entrada', 'saida', 'alteracao')),
  data date,
  descricao text,
  prova_nome text,
  distancia_km numeric(7, 1) check (distancia_km is null or distancia_km >= 0),
  colocacao int check (colocacao is null or colocacao > 0),
  participantes int check (participantes is null or participantes > 0),
  velocidade numeric(9, 3) check (velocidade is null or velocidade >= 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists eventos_pombo on public.eventos (pombo_id, data);

-- ---------- Quem enxerga o quê ----------

-- Pombos que o usuário pode ver: os do plantel dele e os ancestrais deles (para o pedigree).
create or replace function public.pombos_visiveis()
returns setof uuid language sql stable security definer set search_path = '' as $$
  with recursive arv (id, nivel) as (
    select pl.pombo_id, 0 from public.plantel pl where pl.user_id = auth.uid()
    union
    select x.pid, a.nivel + 1
    from arv a
    join public.pombos p on p.id = a.id
    cross join lateral (values (p.pai_id), (p.mae_id)) as x (pid)
    where x.pid is not null and a.nivel < 8
  )
  select distinct id from arv
$$;

create or replace function public.tem_no_plantel(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plantel where pombo_id = p and user_id = auth.uid())
$$;

-- Pode mudar nome/sexo/cor/nascimento/pais: está com o pombo, ou ninguém está com ele.
create or replace function public.pode_editar_pombo(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.tem_no_plantel(p) and (
    exists (select 1 from public.plantel where pombo_id = p and user_id = auth.uid() and situacao = 'ativo')
    or not exists (select 1 from public.plantel where pombo_id = p and situacao = 'ativo')
  )
$$;

alter table public.pombos enable row level security;
alter table public.plantel enable row level security;
alter table public.eventos enable row level security;

drop policy if exists "pombos: ver os meus e ancestrais" on public.pombos;
create policy "pombos: ver os meus e ancestrais" on public.pombos
  for select to authenticated using (id in (select public.pombos_visiveis()));

drop policy if exists "plantel: ver o meu" on public.plantel;
create policy "plantel: ver o meu" on public.plantel
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "eventos: ver histórico" on public.eventos;
create policy "eventos: ver histórico" on public.eventos
  for select to authenticated using (pombo_id in (select public.pombos_visiveis()));

drop policy if exists "eventos: registrar" on public.eventos;
create policy "eventos: registrar" on public.eventos
  for insert to authenticated with check (
    autor_id = (select auth.uid())
    and tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao')
    and public.tem_no_plantel(pombo_id));

drop policy if exists "eventos: alterar os meus" on public.eventos;
create policy "eventos: alterar os meus" on public.eventos
  for update to authenticated
  using (autor_id = (select auth.uid()) and tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao'))
  with check (autor_id = (select auth.uid()) and tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao') and public.tem_no_plantel(pombo_id));

drop policy if exists "eventos: apagar os meus" on public.eventos;
create policy "eventos: apagar os meus" on public.eventos
  for delete to authenticated
  using (autor_id = (select auth.uid()) and tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao'));

-- Pombos e plantel só mudam pelas funções abaixo (que aplicam as regras).
revoke all on public.pombos, public.plantel, public.eventos from anon;
revoke insert, update, delete, truncate on public.pombos, public.plantel from authenticated;
grant select on public.pombos, public.plantel to authenticated;
grant select, insert, update, delete on public.eventos to authenticated;

-- ---------- Registros automáticos ----------

-- Guarda o nome do pombal de quem registrou (fica no histórico mesmo se o pombal mudar de nome).
create or replace function public.eventos_preencher()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.autor_pombal is null and new.autor_id is not null then
      select coalesce(nullif(trim(pf.nome_pombal), ''), nullif(trim(pf.nome), ''))
        into new.autor_pombal from public.perfis pf where pf.id = new.autor_id;
    end if;
    new.autor_pombal := coalesce(new.autor_pombal, 'Pombal sem nome');
  else
    new.autor_id := old.autor_id;
    new.autor_pombal := old.autor_pombal;
    new.tipo := case when old.tipo in ('entrada', 'saida', 'alteracao') then old.tipo else new.tipo end;
    new.atualizado_em := now();
  end if;
  return new;
end $$;

drop trigger if exists eventos_preencher on public.eventos;
create trigger eventos_preencher before insert or update on public.eventos
  for each row execute function public.eventos_preencher();

-- Entrada e saída de pombal viram registros no histórico.
create or replace function public.plantel_registrar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  txt text;
  saiu boolean := new.situacao in ('vendido', 'cedido', 'perdido', 'morto');
begin
  if tg_op = 'UPDATE' then
    new.atualizado_em := now();
    if new.situacao is not distinct from old.situacao then return new; end if;
  end if;

  if new.situacao = 'ativo' and tg_op = 'UPDATE' and old.situacao in ('vendido', 'cedido', 'perdido', 'morto') then
    insert into public.eventos (pombo_id, autor_id, tipo, data, descricao)
    values (new.pombo_id, new.user_id, 'entrada', coalesce(new.data_entrada, current_date), 'Voltou ao pombal');
  elsif new.situacao <> 'referencia' and (tg_op = 'INSERT' or old.situacao = 'referencia') then
    txt := case new.origem
      when 'nascido' then 'Nasceu no pombal'
      when 'comprado' then 'Comprado'
      when 'ganho' then 'Ganho de presente'
      when 'emprestado' then 'Recebido emprestado'
      else 'Entrou no pombal' end;
    if nullif(trim(new.origem_obs), '') is not null then txt := txt || ' · ' || trim(new.origem_obs); end if;
    insert into public.eventos (pombo_id, autor_id, tipo, data, descricao)
    values (new.pombo_id, new.user_id, 'entrada',
            coalesce(new.data_entrada, case when new.origem = 'nascido' then (select nascimento from public.pombos where id = new.pombo_id) end, current_date), txt);
  end if;

  if saiu then
    txt := case new.situacao
      when 'vendido' then 'Vendido'
      when 'cedido' then 'Cedido / emprestado'
      when 'perdido' then 'Perdido (não voltou)'
      else 'Morreu' end;
    if nullif(trim(new.saida_obs), '') is not null then txt := txt || ' · ' || trim(new.saida_obs); end if;
    insert into public.eventos (pombo_id, autor_id, tipo, data, descricao)
    values (new.pombo_id, new.user_id, 'saida', coalesce(new.data_saida, current_date), txt);
  end if;
  return new;
end $$;

drop trigger if exists plantel_registrar_ins on public.plantel;
create trigger plantel_registrar_ins after insert on public.plantel
  for each row execute function public.plantel_registrar();
drop trigger if exists plantel_registrar_upd on public.plantel;
create trigger plantel_registrar_upd before update on public.plantel
  for each row execute function public.plantel_registrar();

-- Mudança de nome, sexo, cor, nascimento, pais ou anilha vira registro no histórico.
create or replace function public.pombos_registrar_alteracao()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  d text[] := '{}';
  sx constant jsonb := '{"M": "Macho", "F": "Fêmea"}';
  a_old text; a_new text;
begin
  new.atualizado_em := now();
  if (new.pais, new.ano, new.numero) is distinct from (old.pais, old.ano, old.numero) then
    d := d || format('Anilha: %s → %s', public.anilha_texto(old.pais, old.ano, old.numero), public.anilha_texto(new.pais, new.ano, new.numero));
  end if;
  if new.nome is distinct from old.nome then
    d := d || format('Nome: %s → %s', coalesce(old.nome, '(vazio)'), coalesce(new.nome, '(vazio)'));
  end if;
  if new.sexo is distinct from old.sexo then
    d := d || format('Sexo: %s → %s', coalesce(sx ->> old.sexo, '(vazio)'), coalesce(sx ->> new.sexo, '(vazio)'));
  end if;
  if new.cor is distinct from old.cor then
    d := d || format('Cor: %s → %s', coalesce(old.cor, '(vazio)'), coalesce(new.cor, '(vazio)'));
  end if;
  if new.nascimento is distinct from old.nascimento then
    d := d || format('Nascimento: %s → %s', coalesce(to_char(old.nascimento, 'DD/MM/YYYY'), '(vazio)'), coalesce(to_char(new.nascimento, 'DD/MM/YYYY'), '(vazio)'));
  end if;
  if new.pai_id is distinct from old.pai_id then
    select public.anilha_texto(pais, ano, numero) into a_old from public.pombos where id = old.pai_id;
    select public.anilha_texto(pais, ano, numero) into a_new from public.pombos where id = new.pai_id;
    d := d || format('Pai: %s → %s', coalesce(a_old, '(vazio)'), coalesce(a_new, '(vazio)'));
  end if;
  if new.mae_id is distinct from old.mae_id then
    a_old := null; a_new := null;
    select public.anilha_texto(pais, ano, numero) into a_old from public.pombos where id = old.mae_id;
    select public.anilha_texto(pais, ano, numero) into a_new from public.pombos where id = new.mae_id;
    d := d || format('Mãe: %s → %s', coalesce(a_old, '(vazio)'), coalesce(a_new, '(vazio)'));
  end if;
  if cardinality(d) > 0 and auth.uid() is not null then
    insert into public.eventos (pombo_id, autor_id, tipo, data, descricao)
    values (new.id, auth.uid(), 'alteracao', current_date, array_to_string(d, '; '));
  end if;
  return new;
end $$;

drop trigger if exists pombos_registrar_alteracao on public.pombos;
create trigger pombos_registrar_alteracao before update on public.pombos
  for each row execute function public.pombos_registrar_alteracao();

-- ---------- Funções usadas pelo app ----------

-- Lê uma anilha {pais, ano, numero} e devolve o pombo (cria se não existir).
-- Usada para pai e mãe: o sexo é preenchido se estiver em branco.
create or replace function public.pombo_da_anilha(j jsonb, p_sexo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pais text; v_ano int; v_num text; v_id uuid; v_sexo text;
begin
  if j is null or jsonb_typeof(j) <> 'object' then return null; end if;
  v_pais := upper(trim(coalesce(j ->> 'pais', 'BRA')));
  v_num := trim(coalesce(j ->> 'numero', ''));
  v_ano := public.anilha_ano4(nullif(trim(j ->> 'ano'), '')::int);
  if v_num = '' then return null; end if;
  if v_ano is null or v_pais !~ '^[A-Z]{2,4}$' then
    raise exception 'Anilha % incompleta: confira o ano e o país.', v_num;
  end if;
  select id, sexo into v_id, v_sexo from public.pombos
    where pais = v_pais and ano = v_ano and public.anilha_numero_norm(numero) = public.anilha_numero_norm(v_num);
  if v_id is null then
    insert into public.pombos (pais, ano, numero, sexo, criado_por)
    values (v_pais, v_ano, v_num, p_sexo, auth.uid()) returning id into v_id;
  elsif v_sexo is null then
    update public.pombos set sexo = p_sexo where id = v_id;
  elsif v_sexo <> p_sexo then
    raise exception 'A anilha % está cadastrada como %, não pode ser %.',
      public.anilha_texto(v_pais, v_ano, v_num),
      case v_sexo when 'M' then 'macho' else 'fêmea' end,
      case p_sexo when 'M' then 'o pai' else 'a mãe' end;
  end if;
  return v_id;
end $$;

-- Apaga um pombo que ficou sem dono, sem histórico e que não é pai/mãe de ninguém.
create or replace function public.apagar_se_orfao(p uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p is null then return; end if;
  if exists (select 1 from public.plantel where pombo_id = p)
     or exists (select 1 from public.eventos where pombo_id = p and tipo <> 'alteracao')
     or exists (select 1 from public.pombos where pai_id = p or mae_id = p) then
    return;
  end if;
  delete from public.pombos where id = p;
end $$;

-- Antes de cadastrar: essa anilha já está no app?
create or replace function public.buscar_anilha(p_pais text, p_ano int, p_numero text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid; v_ano int := public.anilha_ano4(p_ano);
begin
  select id into v_id from public.pombos
    where pais = upper(trim(p_pais)) and ano = v_ano and public.anilha_numero_norm(numero) = public.anilha_numero_norm(p_numero);
  if v_id is null then return jsonb_build_object('existe', false); end if;
  return jsonb_build_object(
    'existe', true,
    'pombo_id', v_id,
    'no_meu_plantel', public.tem_no_plantel(v_id),
    'pombais', (select count(*) from public.plantel where pombo_id = v_id and situacao <> 'referencia'),
    'registros', (select count(*) from public.eventos where pombo_id = v_id));
end $$;

-- Cadastra ou altera um pombo do plantel. Recebe tudo num objeto:
-- {plantel_id?, pais, ano, numero, nome, sexo, cor, nascimento, pai:{pais,ano,numero}|null, mae:…,
--  situacao, origem, origem_obs, data_entrada, data_saida, saida_obs, observacoes}
create or replace function public.salvar_pombo(d jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_pl public.plantel;
  v_pl_id uuid;
  v_pais text; v_ano int; v_num text;
  v_pombo uuid; v_antigo uuid;
  v_existia boolean;
  v_pai uuid; v_mae uuid;
  v_pode boolean;
  p public.pombos;
  ign text[] := '{}';
  v_nome text := nullif(trim(d ->> 'nome'), '');
  v_sexo text := nullif(d ->> 'sexo', '');
  v_cor text := nullif(trim(d ->> 'cor'), '');
  v_nasc date := nullif(d ->> 'nascimento', '')::date;
begin
  if uid is null then raise exception 'Sua sessão expirou. Entre de novo.'; end if;
  v_pais := upper(trim(coalesce(d ->> 'pais', '')));
  v_num := trim(coalesce(d ->> 'numero', ''));
  v_ano := public.anilha_ano4(nullif(trim(d ->> 'ano'), '')::int);
  if v_num = '' or v_ano is null or v_pais !~ '^[A-Z]{2,4}$' then
    raise exception 'Anilha incompleta: preencha o número, o ano e o país.';
  end if;
  if v_sexo is not null and v_sexo not in ('M', 'F') then raise exception 'Sexo inválido.'; end if;

  if nullif(d ->> 'plantel_id', '') is not null then
    select * into v_pl from public.plantel where id = (d ->> 'plantel_id')::uuid and user_id = uid;
    if not found then raise exception 'Este pombo não está no seu plantel.'; end if;
    v_antigo := v_pl.pombo_id;
  end if;

  select id into v_pombo from public.pombos
    where pais = v_pais and ano = v_ano and public.anilha_numero_norm(numero) = public.anilha_numero_norm(v_num);
  v_existia := v_pombo is not null;

  v_pai := public.pombo_da_anilha(d -> 'pai', 'M');
  v_mae := public.pombo_da_anilha(d -> 'mae', 'F');
  if v_pombo is not null and (v_pai = v_pombo or v_mae = v_pombo) then
    raise exception 'Um pombo não pode ser pai ou mãe dele mesmo.';
  end if;

  if v_pombo is null then
    insert into public.pombos (pais, ano, numero, nome, sexo, cor, nascimento, pai_id, mae_id, criado_por)
    values (v_pais, v_ano, v_num, v_nome, v_sexo, v_cor, v_nasc, v_pai, v_mae, uid)
    returning id into v_pombo;
  end if;

  if v_antigo is not null and v_antigo = v_pombo then
    -- Mesmo pombo: só atualiza os dados do meu plantel.
    update public.plantel set
      situacao = coalesce(nullif(d ->> 'situacao', ''), 'ativo'),
      origem = nullif(d ->> 'origem', ''),
      origem_obs = nullif(trim(d ->> 'origem_obs'), ''),
      data_entrada = nullif(d ->> 'data_entrada', '')::date,
      data_saida = nullif(d ->> 'data_saida', '')::date,
      saida_obs = nullif(trim(d ->> 'saida_obs'), ''),
      observacoes = nullif(trim(d ->> 'observacoes'), '')
    where id = v_pl.id;
    v_pl_id := v_pl.id;
  else
    if exists (select 1 from public.plantel where user_id = uid and pombo_id = v_pombo) then
      raise exception 'A anilha % já está no seu plantel.', public.anilha_texto(v_pais, v_ano, v_num);
    end if;
    if v_antigo is not null then
      -- Anilha corrigida: leva para o pombo certo o que este usuário registrou.
      delete from public.eventos where pombo_id = v_antigo and autor_id = uid and tipo in ('entrada', 'saida');
      update public.eventos set pombo_id = v_pombo
        where pombo_id = v_antigo and autor_id = uid and tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao');
      delete from public.plantel where id = v_pl.id;
    end if;
    insert into public.plantel (user_id, pombo_id, situacao, origem, origem_obs, data_entrada, data_saida, saida_obs, observacoes)
    values (uid, v_pombo,
      coalesce(nullif(d ->> 'situacao', ''), 'ativo'),
      nullif(d ->> 'origem', ''),
      nullif(trim(d ->> 'origem_obs'), ''),
      nullif(d ->> 'data_entrada', '')::date,
      nullif(d ->> 'data_saida', '')::date,
      nullif(trim(d ->> 'saida_obs'), ''),
      nullif(trim(d ->> 'observacoes'), ''))
    returning id into v_pl_id;
    if v_antigo is not null and not exists (select 1 from public.plantel where pombo_id = v_antigo) then
      -- Ninguém mais tem a anilha antiga: era erro de digitação. Os filhos passam para a anilha certa.
      update public.pombos set pai_id = v_pombo where pai_id = v_antigo and id <> v_pombo;
      update public.pombos set mae_id = v_pombo where mae_id = v_antigo and id <> v_pombo;
      perform public.apagar_se_orfao(v_antigo);
    end if;
  end if;

  -- Dados do pombo (valem para todos os pombais).
  -- Quem acaba de cadastrar um pombo que já existia só completa o que está em branco.
  select * into p from public.pombos where id = v_pombo for update;
  v_pode := public.pode_editar_pombo(v_pombo) and (not v_existia or v_antigo = v_pombo);
  if v_pode or p.nome is null then p.nome := v_nome; elsif v_nome is not null and v_nome is distinct from p.nome then ign := array_append(ign, 'nome'); end if;
  if v_pode or p.sexo is null then p.sexo := v_sexo; elsif v_sexo is not null and v_sexo is distinct from p.sexo then ign := array_append(ign, 'sexo'); end if;
  if v_pode or p.cor is null then p.cor := v_cor; elsif v_cor is not null and v_cor is distinct from p.cor then ign := array_append(ign, 'cor'); end if;
  if v_pode or p.nascimento is null then p.nascimento := v_nasc; elsif v_nasc is not null and v_nasc is distinct from p.nascimento then ign := array_append(ign, 'nascimento'); end if;
  if v_pode or p.pai_id is null then p.pai_id := v_pai; elsif v_pai is not null and v_pai is distinct from p.pai_id then ign := array_append(ign, 'pai'); end if;
  if v_pode or p.mae_id is null then p.mae_id := v_mae; elsif v_mae is not null and v_mae is distinct from p.mae_id then ign := array_append(ign, 'mae'); end if;

  if p.sexo = 'F' and exists (select 1 from public.pombos where pai_id = v_pombo) then
    raise exception 'Este pombo já é pai de outro pombo, não pode ser fêmea.';
  end if;
  if p.sexo = 'M' and exists (select 1 from public.pombos where mae_id = v_pombo) then
    raise exception 'Este pombo já é mãe de outro pombo, não pode ser macho.';
  end if;

  update public.pombos set nome = p.nome, sexo = p.sexo, cor = p.cor, nascimento = p.nascimento,
    pai_id = p.pai_id, mae_id = p.mae_id
  where id = v_pombo;

  -- Pai e mãe entram no meu plantel como "ancestral" (para eu poder completar os dados deles).
  insert into public.plantel (user_id, pombo_id, situacao)
  select uid, x, 'referencia' from unnest(array[p.pai_id, p.mae_id]) as x
  where x is not null and x in (v_pai, v_mae)
  on conflict (user_id, pombo_id) do nothing;

  return jsonb_build_object('plantel_id', v_pl_id, 'pombo_id', v_pombo, 'ja_existia', v_existia, 'ignorados', to_jsonb(ign));
end $$;

-- Tira o pombo do meu plantel. Entradas e saídas automáticas saem junto;
-- os outros registros que eu fiz só saem se eu pedir.
create or replace function public.remover_do_plantel(p_plantel uuid, p_apagar_registros boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pl public.plantel;
begin
  select * into v_pl from public.plantel where id = p_plantel and user_id = auth.uid();
  if not found then raise exception 'Este pombo não está no seu plantel.'; end if;
  delete from public.eventos
    where pombo_id = v_pl.pombo_id and autor_id = auth.uid()
      and (tipo in ('entrada', 'saida') or coalesce(p_apagar_registros, false));
  delete from public.plantel where id = v_pl.id;
  perform public.apagar_se_orfao(v_pl.pombo_id);
end $$;

-- Pombais por onde o pombo passou (nome do pombal e cidade; sem e-mail nem telefone).
create or replace function public.donos_do_pombo(p uuid)
returns table (nome_pombal text, nome text, cidade text, situacao text, origem text,
               data_entrada date, data_saida date, voce boolean, desde timestamptz)
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(trim(pf.nome_pombal), ''), 'Pombal sem nome'), pf.nome, pf.cidade,
         pl.situacao, pl.origem, ent.data, pl.data_saida, pl.user_id = auth.uid(), pl.criado_em
  from public.plantel pl
  left join public.perfis pf on pf.id = pl.user_id
  cross join lateral (
    select coalesce(pl.data_entrada,
      (select min(e.data) from public.eventos e where e.pombo_id = p and e.autor_id = pl.user_id and e.tipo = 'entrada')) as data
  ) ent
  where pl.pombo_id = p and pl.situacao <> 'referencia'
    and p in (select public.pombos_visiveis())
  order by coalesce(ent.data, pl.criado_em::date), pl.criado_em
$$;

-- Filhos do pombo cadastrados no app, em qualquer pombal.
create or replace function public.filhos_do_pombo(p uuid)
returns table (id uuid, anilha text, ano int, nome text, sexo text, cor text, visivel boolean, pombais text)
language sql stable security definer set search_path = '' as $$
  with vis as (select public.pombos_visiveis() as id)
  select c.id, public.anilha_texto(c.pais, c.ano, c.numero), c.ano, c.nome, c.sexo, c.cor,
         c.id in (select id from vis),
         (select string_agg(distinct coalesce(nullif(trim(pf.nome_pombal), ''), 'Pombal sem nome'), ', ')
            from public.plantel pl left join public.perfis pf on pf.id = pl.user_id
           where pl.pombo_id = c.id and pl.situacao = 'ativo')
  from public.pombos c
  where (c.pai_id = p or c.mae_id = p) and p in (select id from vis)
  order by c.ano desc, c.numero
$$;

revoke execute on function
  public.pombos_visiveis(), public.tem_no_plantel(uuid), public.pode_editar_pombo(uuid),
  public.pombo_da_anilha(jsonb, text), public.apagar_se_orfao(uuid),
  public.buscar_anilha(text, int, text), public.salvar_pombo(jsonb), public.remover_do_plantel(uuid, boolean),
  public.donos_do_pombo(uuid), public.filhos_do_pombo(uuid)
  from public, anon;
revoke execute on function public.pombo_da_anilha(jsonb, text), public.apagar_se_orfao(uuid) from authenticated;
grant execute on function
  public.pombos_visiveis(), public.tem_no_plantel(uuid), public.pode_editar_pombo(uuid),
  public.buscar_anilha(text, int, text), public.salvar_pombo(jsonb), public.remover_do_plantel(uuid, boolean),
  public.donos_do_pombo(uuid), public.filhos_do_pombo(uuid)
  to authenticated;
