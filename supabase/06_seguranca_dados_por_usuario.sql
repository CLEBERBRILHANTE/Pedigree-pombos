-- Passo 6: correções de segurança.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 05_aviso_novo_cadastro.sql (ou do 04_admin.sql, se não usa o aviso). Pode rodar de novo sem problema.
--
-- O que muda:
--  * Nome, sexo, cor, nascimento, pai, mãe e fotos de cada pombo passam a ser de cada usuário.
--    Se outra pessoa cadastrar a mesma anilha, o que ela mudar aparece só para ela.
--    Na primeira vez que este arquivo roda, cada usuário fica com uma cópia dos dados de hoje
--    de todos os pombos do plantel dele e dos ancestrais (nada se perde).
--  * O histórico (provas, prêmios, saúde, reprodução, observações, entradas e saídas) continua
--    compartilhado por anilha. Cada registro só pode ser alterado ou apagado por quem o cadastrou,
--    e o nome do pombal no registro é sempre o do autor (não dá mais para assinar como outro pombal).
--  * Mudanças nos dados do pombo não vão mais para o histórico, porque agora esses dados são particulares.
--  * As fotos de cada usuário ficam na pasta dele (fotos/<id do usuário>/<id do pombo>/...)
--    e só ele vê e apaga. Limites: 1,5 MB por foto e 600 fotos por usuário.
--  * Limites de tamanho nos textos e de quantidade (5.000 pombos e 20.000 registros por usuário),
--    para ninguém conseguir lotar o espaço grátis do Supabase.

-- ---------- Dados do pombo de cada usuário ----------

create table if not exists public.dados_pombo (
  user_id uuid not null references auth.users (id) on delete cascade,
  pombo_id uuid not null references public.pombos (id) on delete cascade,
  nome text check (nome is null or length(nome) <= 80),
  sexo text check (sexo in ('M', 'F')),
  cor text check (cor is null or length(cor) <= 60),
  nascimento date,
  pai_id uuid references public.pombos (id) on delete set null,
  mae_id uuid references public.pombos (id) on delete set null,
  foto_olho text,
  foto_cabeca text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, pombo_id),
  constraint dados_pombo_nao_e_pai_de_si check (pai_id is distinct from pombo_id and mae_id is distinct from pombo_id)
);
create index if not exists dados_pombo_pombo on public.dados_pombo (pombo_id);
create index if not exists dados_pombo_pai on public.dados_pombo (pai_id);
create index if not exists dados_pombo_mae on public.dados_pombo (mae_id);

alter table public.dados_pombo enable row level security;
drop policy if exists "dados_pombo: ver os meus" on public.dados_pombo;
create policy "dados_pombo: ver os meus" on public.dados_pombo
  for select to authenticated using (user_id = (select auth.uid()));
-- Só muda pelas funções abaixo.
revoke all on public.dados_pombo from anon, authenticated;
grant select on public.dados_pombo to authenticated;

drop trigger if exists dados_pombo_atualizado_em on public.dados_pombo;
create trigger dados_pombo_atualizado_em before update on public.dados_pombo
  for each row execute function public.tocar_atualizado_em();

-- Cópia inicial (só roda uma vez: quando a tabela ainda está vazia).
-- Cada usuário recebe os dados de hoje dos pombos do plantel dele e dos ancestrais (até 8 gerações).
do $$
begin
  if not exists (select 1 from public.dados_pombo) then
    with recursive arv (user_id, id, nivel) as (
      select pl.user_id, pl.pombo_id, 0 from public.plantel pl
      union
      select a.user_id, x.pid, a.nivel + 1
      from arv a
      join public.pombos p on p.id = a.id
      cross join lateral (values (p.pai_id), (p.mae_id)) as x (pid)
      where x.pid is not null and a.nivel < 8
    )
    insert into public.dados_pombo (user_id, pombo_id, nome, sexo, cor, nascimento, pai_id, mae_id, foto_olho, foto_cabeca)
    select distinct on (a.user_id, a.id) a.user_id, a.id, left(p.nome, 80), p.sexo, left(p.cor, 60), p.nascimento,
           p.pai_id, p.mae_id, p.foto_olho, p.foto_cabeca
    from arv a join public.pombos p on p.id = a.id
    order by a.user_id, a.id
    on conflict do nothing;
  end if;
end $$;

-- A tabela "pombos" agora guarda só a anilha. O app não lê mais direto dela.
drop policy if exists "pombos: ver os meus e ancestrais" on public.pombos;
revoke all on public.pombos from anon, authenticated;
-- Mudanças de dados não vão mais para o histórico compartilhado.
drop trigger if exists pombos_registrar_alteracao on public.pombos;

-- ---------- Limites de tamanho dos textos (valem para o que for gravado daqui em diante) ----------

alter table public.perfis drop constraint if exists perfis_tamanhos;
alter table public.perfis add constraint perfis_tamanhos check (
  coalesce(length(nome), 0) <= 100 and coalesce(length(nome_pombal), 0) <= 100 and coalesce(length(cidade), 0) <= 150
  and coalesce(length(email_contato), 0) <= 200 and coalesce(length(telefone), 0) <= 40) not valid;

alter table public.plantel drop constraint if exists plantel_tamanhos;
alter table public.plantel add constraint plantel_tamanhos check (
  coalesce(length(observacoes), 0) <= 4000 and coalesce(length(origem_obs), 0) <= 300
  and coalesce(length(saida_obs), 0) <= 300) not valid;

alter table public.eventos drop constraint if exists eventos_tamanhos;
alter table public.eventos add constraint eventos_tamanhos check (
  coalesce(length(descricao), 0) <= 2000 and coalesce(length(prova_nome), 0) <= 200) not valid;

-- Perfil criado no cadastro: corta nomes compridos demais (em vez de travar o cadastro).
create or replace function public.criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (id, nome, nome_pombal, email_contato)
  values (
    new.id,
    left(new.raw_user_meta_data ->> 'nome', 100),
    left(new.raw_user_meta_data ->> 'nome_pombal', 100),
    left(new.email, 200)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- Histórico: autor sempre verdadeiro ----------

create or replace function public.eventos_preencher()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.autor_id := auth.uid();
      if new.tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao')
         and (select count(*) from public.eventos where autor_id = auth.uid()) >= 20000 then
        raise exception 'Você chegou ao limite de 20.000 registros no histórico.';
      end if;
    end if;
    -- O nome do pombal vem sempre do perfil do autor (nunca do que foi enviado).
    new.autor_pombal := null;
    if new.autor_id is not null then
      select coalesce(nullif(trim(pf.nome_pombal), ''), nullif(trim(pf.nome), ''))
        into new.autor_pombal from public.perfis pf where pf.id = new.autor_id;
    end if;
    new.autor_pombal := coalesce(new.autor_pombal, 'Pombal sem nome');
    new.criado_em := now();
    new.atualizado_em := now();
  else
    new.autor_id := old.autor_id;
    new.autor_pombal := old.autor_pombal;
    new.criado_em := old.criado_em;
    new.tipo := case when old.tipo in ('entrada', 'saida', 'alteracao') then old.tipo else new.tipo end;
    new.atualizado_em := now();
  end if;
  return new;
end $$;

-- ---------- Quem enxerga o quê ----------

-- Pombos que o usuário vê: os que têm dados dele (plantel e ancestrais).
create or replace function public.pombos_visiveis()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select pombo_id from public.dados_pombo where user_id = auth.uid()
  union
  select pombo_id from public.plantel where user_id = auth.uid()
$$;

-- Cada um muda os próprios dados de qualquer pombo do seu plantel.
create or replace function public.pode_editar_pombo(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.tem_no_plantel(p)
$$;

-- Os pombos do usuário com os dados dele (é o que o app carrega).
create or replace function public.meus_pombos()
returns table (id uuid, pais text, ano smallint, numero text, nome text, sexo text, cor text, nascimento date,
               pai_id uuid, mae_id uuid, foto_olho text, foto_cabeca text, criado_em timestamptz, atualizado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.pais, p.ano, p.numero, d.nome, d.sexo, d.cor, d.nascimento, d.pai_id, d.mae_id,
         d.foto_olho, d.foto_cabeca, d.criado_em, d.atualizado_em
  from public.dados_pombo d join public.pombos p on p.id = d.pombo_id
  where d.user_id = auth.uid()
$$;

-- ---------- Funções usadas pelo app ----------

-- Garante que o usuário tem os próprios dados deste pombo, com o sexo certo (para pai e mãe).
create or replace function public.garantir_meus_dados(p uuid, p_sexo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sexo text; achou boolean;
begin
  select sexo, true into v_sexo, achou from public.dados_pombo where user_id = auth.uid() and pombo_id = p;
  if achou is null then
    insert into public.dados_pombo (user_id, pombo_id, sexo) values (auth.uid(), p, p_sexo);
  elsif v_sexo is null then
    update public.dados_pombo set sexo = p_sexo where user_id = auth.uid() and pombo_id = p;
  elsif v_sexo <> p_sexo then
    raise exception 'A anilha % está cadastrada como %, não pode ser %.',
      (select public.anilha_texto(pais, ano, numero) from public.pombos where id = p),
      case v_sexo when 'M' then 'macho' else 'fêmea' end,
      case p_sexo when 'M' then 'o pai' else 'a mãe' end;
  end if;
end $$;

-- Lê uma anilha {pais, ano, numero} e devolve o pombo (cria se não existir). Usada para pai e mãe.
create or replace function public.pombo_da_anilha(j jsonb, p_sexo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pais text; v_ano int; v_num text; v_id uuid;
begin
  if j is null or jsonb_typeof(j) <> 'object' then return null; end if;
  v_pais := upper(trim(coalesce(j ->> 'pais', 'BRA')));
  v_num := trim(coalesce(j ->> 'numero', ''));
  v_ano := public.anilha_ano4(nullif(trim(j ->> 'ano'), '')::int);
  if v_num = '' then return null; end if;
  if v_ano is null or v_pais !~ '^[A-Z]{2,4}$' then
    raise exception 'Anilha % incompleta: confira o ano e o país.', v_num;
  end if;
  select id into v_id from public.pombos
    where pais = v_pais and ano = v_ano and public.anilha_numero_norm(numero) = public.anilha_numero_norm(v_num);
  if v_id is null then
    insert into public.pombos (pais, ano, numero, criado_por)
    values (v_pais, v_ano, v_num, auth.uid()) returning id into v_id;
  end if;
  perform public.garantir_meus_dados(v_id, p_sexo);
  return v_id;
end $$;

-- Apaga uma anilha que ninguém mais usa (sem plantel, sem dados, sem histórico, não é pai/mãe de ninguém).
create or replace function public.apagar_se_orfao(p uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p is null then return; end if;
  if exists (select 1 from public.plantel where pombo_id = p)
     or exists (select 1 from public.dados_pombo where pombo_id = p or pai_id = p or mae_id = p)
     or exists (select 1 from public.eventos where pombo_id = p and tipo <> 'alteracao') then
    return;
  end if;
  delete from public.pombos where id = p;
end $$;

-- Cadastra ou altera um pombo do plantel. Recebe tudo num objeto:
-- {plantel_id?, pais, ano, numero, nome, sexo, cor, nascimento, pai:{pais,ano,numero}|null, mae:…,
--  situacao, origem, origem_obs, data_entrada, data_saida, saida_obs, observacoes}
-- Os dados (nome, sexo, cor, nascimento, pais) são só deste usuário.
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
  v_foto_olho text; v_foto_cabeca text;
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
  if length(v_nome) > 80 then raise exception 'O nome pode ter no máximo 80 letras.'; end if;
  if length(v_cor) > 60 then raise exception 'A cor pode ter no máximo 60 letras.'; end if;
  if length(d ->> 'observacoes') > 4000 then raise exception 'As observações podem ter no máximo 4.000 letras.'; end if;
  if length(d ->> 'origem_obs') > 300 or length(d ->> 'saida_obs') > 300 then
    raise exception 'Os detalhes de entrada e saída podem ter no máximo 300 letras.';
  end if;

  if nullif(d ->> 'plantel_id', '') is not null then
    select * into v_pl from public.plantel where id = (d ->> 'plantel_id')::uuid and user_id = uid;
    if not found then raise exception 'Este pombo não está no seu plantel.'; end if;
    v_antigo := v_pl.pombo_id;
  elsif (select count(*) from public.plantel where user_id = uid) >= 5000 then
    raise exception 'Você chegou ao limite de 5.000 pombos no plantel.';
  end if;

  select id into v_pombo from public.pombos
    where pais = v_pais and ano = v_ano and public.anilha_numero_norm(numero) = public.anilha_numero_norm(v_num);
  v_existia := v_pombo is not null;
  if v_pombo is null then
    insert into public.pombos (pais, ano, numero, criado_por) values (v_pais, v_ano, v_num, uid)
    returning id into v_pombo;
  end if;

  v_pai := public.pombo_da_anilha(d -> 'pai', 'M');
  v_mae := public.pombo_da_anilha(d -> 'mae', 'F');
  if v_pai = v_pombo or v_mae = v_pombo then
    raise exception 'Um pombo não pode ser pai ou mãe dele mesmo.';
  end if;

  if v_antigo is not null and v_antigo = v_pombo then
    -- Mesmo pombo: atualiza os dados do meu plantel.
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
      -- Anilha corrigida: leva para a anilha certa o que este usuário registrou e os dados dele.
      delete from public.eventos where pombo_id = v_antigo and autor_id = uid and tipo in ('entrada', 'saida');
      update public.eventos set pombo_id = v_pombo
        where pombo_id = v_antigo and autor_id = uid and tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao');
      select foto_olho, foto_cabeca into v_foto_olho, v_foto_cabeca
        from public.dados_pombo where user_id = uid and pombo_id = v_antigo;
      update public.dados_pombo set pai_id = v_pombo where user_id = uid and pai_id = v_antigo and pombo_id <> v_pombo;
      update public.dados_pombo set mae_id = v_pombo where user_id = uid and mae_id = v_antigo and pombo_id <> v_pombo;
      delete from public.dados_pombo where user_id = uid and pombo_id = v_antigo;
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
    if v_antigo is not null then perform public.apagar_se_orfao(v_antigo); end if;
  end if;

  -- Meus dados do pombo (só eu vejo e mudo).
  if v_sexo = 'F' and exists (select 1 from public.dados_pombo where user_id = uid and pai_id = v_pombo) then
    raise exception 'Este pombo já é pai de outro pombo, não pode ser fêmea.';
  end if;
  if v_sexo = 'M' and exists (select 1 from public.dados_pombo where user_id = uid and mae_id = v_pombo) then
    raise exception 'Este pombo já é mãe de outro pombo, não pode ser macho.';
  end if;
  insert into public.dados_pombo (user_id, pombo_id, nome, sexo, cor, nascimento, pai_id, mae_id, foto_olho, foto_cabeca)
  values (uid, v_pombo, v_nome, v_sexo, v_cor, v_nasc, v_pai, v_mae, v_foto_olho, v_foto_cabeca)
  on conflict (user_id, pombo_id) do update set
    nome = excluded.nome, sexo = excluded.sexo, cor = excluded.cor, nascimento = excluded.nascimento,
    pai_id = excluded.pai_id, mae_id = excluded.mae_id,
    foto_olho = coalesce(public.dados_pombo.foto_olho, excluded.foto_olho),
    foto_cabeca = coalesce(public.dados_pombo.foto_cabeca, excluded.foto_cabeca);

  -- Pai e mãe entram no meu plantel como "ancestral" (para eu poder completar os dados deles).
  insert into public.plantel (user_id, pombo_id, situacao)
  select uid, x, 'referencia' from unnest(array[v_pai, v_mae]) as x
  where x is not null
  on conflict (user_id, pombo_id) do nothing;

  return jsonb_build_object('plantel_id', v_pl_id, 'pombo_id', v_pombo, 'ja_existia', v_existia, 'ignorados', '[]'::jsonb);
end $$;

-- Tira o pombo do meu plantel. O histórico (registros, entradas e saídas) fica guardado
-- (passo 7); o segundo valor é ignorado e existe só para o app antigo.
-- Devolve as fotos que o app deve apagar (só da pasta do próprio usuário).
drop function if exists public.remover_do_plantel(uuid, boolean);
create function public.remover_do_plantel(p_plantel uuid, p_apagar_registros boolean default false)
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

-- Filhos do pombo: os do meu plantel e, em outros pombais, os que o dono de lá diz serem filhos dele.
-- De pombos de outros pombais aparece só a anilha e o pombal (nome, sexo e cor são particulares).
create or replace function public.filhos_do_pombo(p uuid)
returns table (id uuid, anilha text, ano int, nome text, sexo text, cor text, visivel boolean, pombais text)
language sql stable security definer set search_path = '' as $$
  select c.id, public.anilha_texto(c.pais, c.ano, c.numero), c.ano::int, m.nome, m.sexo, m.cor,
         m.pombo_id is not null,
         (select string_agg(distinct coalesce(nullif(trim(pf.nome_pombal), ''), 'Pombal sem nome'), ', ')
            from public.plantel pl left join public.perfis pf on pf.id = pl.user_id
           where pl.pombo_id = c.id and pl.situacao = 'ativo')
  from public.pombos c
  left join public.dados_pombo m on m.user_id = auth.uid() and m.pombo_id = c.id
  where p in (select public.pombos_visiveis())
    and c.id in (
      select dp.pombo_id from public.dados_pombo dp
      where (dp.pai_id = p or dp.mae_id = p)
        and (dp.user_id = auth.uid() or exists (
          select 1 from public.plantel pl2
          where pl2.user_id = dp.user_id and pl2.pombo_id = dp.pombo_id and pl2.situacao <> 'referencia')))
  order by c.ano desc, c.numero
$$;

-- ---------- Fotos: cada usuário na sua pasta ----------

update storage.buckets set file_size_limit = 1572864 where id = 'fotos';

create or replace function public.uuid_ou_nulo(t text)
returns uuid language sql immutable set search_path = '' as $$
  select case when t ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then t::uuid end
$$;

-- Quantas fotos o usuário já tem na pasta dele.
create or replace function public.minhas_fotos_total()
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from storage.objects where bucket_id = 'fotos' and split_part(name, '/', 1) = auth.uid()::text
$$;

drop policy if exists "fotos: ver" on storage.objects;
create policy "fotos: ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and (
    split_part(name, '/', 1) = (select auth.uid())::text
    -- fotos antigas (de antes desta mudança) que estão nos meus dados
    or name in (select d.foto_olho from public.dados_pombo d where d.user_id = (select auth.uid()))
    or name in (select d.foto_cabeca from public.dados_pombo d where d.user_id = (select auth.uid()))));

drop policy if exists "fotos: enviar" on storage.objects;
create policy "fotos: enviar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and public.tem_no_plantel(public.uuid_ou_nulo(split_part(name, '/', 2)))
    and public.minhas_fotos_total() < 600);

drop policy if exists "fotos: trocar" on storage.objects;
create policy "fotos: trocar" on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos' and split_part(name, '/', 1) = (select auth.uid())::text)
  with check (bucket_id = 'fotos' and split_part(name, '/', 1) = (select auth.uid())::text);

drop policy if exists "fotos: apagar" on storage.objects;
create policy "fotos: apagar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos' and split_part(name, '/', 1) = (select auth.uid())::text);

-- Grava qual é a foto atual nos MEUS dados do pombo. p_tipo: 'olho' ou 'cabeca'. p_caminho vazio = remover.
-- Devolve a foto anterior quando ela é da minha pasta (o app apaga o arquivo antigo).
create or replace function public.definir_foto(p_pombo uuid, p_tipo text, p_caminho text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  anterior text;
  caminho text := nullif(trim(coalesce(p_caminho, '')), '');
begin
  if uid is null then raise exception 'Entre na sua conta.'; end if;
  if p_tipo not in ('olho', 'cabeca') then raise exception 'Tipo de foto inválido.'; end if;
  if not public.tem_no_plantel(p_pombo) then
    raise exception 'Só dá para pôr fotos em pombos do seu plantel.';
  end if;
  if caminho is not null and (split_part(caminho, '/', 1) <> uid::text or split_part(caminho, '/', 2) <> p_pombo::text) then
    raise exception 'Caminho da foto inválido.';
  end if;
  insert into public.dados_pombo (user_id, pombo_id) values (uid, p_pombo) on conflict do nothing;
  if p_tipo = 'olho' then
    select foto_olho into anterior from public.dados_pombo where user_id = uid and pombo_id = p_pombo for update;
    update public.dados_pombo set foto_olho = caminho where user_id = uid and pombo_id = p_pombo;
  else
    select foto_cabeca into anterior from public.dados_pombo where user_id = uid and pombo_id = p_pombo for update;
    update public.dados_pombo set foto_cabeca = caminho where user_id = uid and pombo_id = p_pombo;
  end if;
  if anterior is not null and split_part(anterior, '/', 1) <> uid::text then return null; end if;
  return anterior;
end $$;

-- ---------- Tela de administrador (usa os dados de cada usuário) ----------

create or replace function public.admin_resumo()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.exigir_admin();
  select jsonb_build_object(
    'usuarios', (select count(*) from auth.users),
    'confirmados', (select count(*) from auth.users where email_confirmed_at is not null),
    'novos_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'novos_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'ativos_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'pombais', (select count(*) from public.perfis where nullif(trim(nome_pombal), '') is not null),
    'com_pombos', (select count(distinct user_id) from public.plantel),
    'pombos', (select count(*) from public.pombos),
    'pombos_ativos', (select count(distinct pombo_id) from public.plantel where situacao = 'ativo'),
    'registros', (select count(*) from public.eventos where tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao')),
    'provas', (select count(*) from public.eventos where tipo = 'prova'),
    'fotos', (select count(*) from storage.objects where bucket_id = 'fotos'),
    'fotos_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'fotos')
  ) into r;
  return r;
end $$;

create or replace function public.admin_plantel_do_usuario(p_usuario uuid)
returns table (pombo_id uuid, anilha text, nome text, sexo text, cor text, situacao text, entrou_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.exigir_admin();
  return query
  select po.id, public.anilha_texto(po.pais, po.ano, po.numero), d.nome, d.sexo, d.cor, pl.situacao, pl.criado_em
  from public.plantel pl
  join public.pombos po on po.id = pl.pombo_id
  left join public.dados_pombo d on d.user_id = pl.user_id and d.pombo_id = pl.pombo_id
  where pl.user_id = p_usuario
  order by (pl.situacao = 'ativo') desc, po.ano desc, po.numero;
end $$;

-- Nome, sexo e cor vêm dos dados de quem está com o pombo (ou de quem o cadastrou).
create or replace function public.admin_pombos(p_busca text default '', p_limite int default 200)
returns table (pombo_id uuid, anilha text, nome text, sexo text, cor text, criado_em timestamptz,
               pombais bigint, com_quem text, fotos int)
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(trim(coalesce(p_busca, '')));
begin
  perform public.exigir_admin();
  return query
  select po.id, public.anilha_texto(po.pais, po.ano, po.numero), d.nome, d.sexo, d.cor, po.criado_em,
         (select count(*) from public.plantel pl where pl.pombo_id = po.id and pl.situacao <> 'referencia'),
         (select string_agg(coalesce(nullif(pf.nome_pombal, ''), pf.nome, 'Sem nome'), ', ')
            from public.plantel pl left join public.perfis pf on pf.id = pl.user_id
           where pl.pombo_id = po.id and pl.situacao = 'ativo'),
         (select count(x.foto_olho)::int + count(x.foto_cabeca)::int from public.dados_pombo x where x.pombo_id = po.id)
  from public.pombos po
  left join lateral (
    select dp.nome, dp.sexo, dp.cor from public.dados_pombo dp
    left join public.plantel pl on pl.user_id = dp.user_id and pl.pombo_id = dp.pombo_id
    where dp.pombo_id = po.id
    order by (pl.situacao = 'ativo') desc nulls last, (dp.user_id = po.criado_por) desc nulls last, dp.criado_em
    limit 1) d on true
  where q = ''
     or lower(public.anilha_texto(po.pais, po.ano, po.numero)) like '%' || q || '%'
     or lower(coalesce(d.nome, '')) like '%' || q || '%'
     or lower(coalesce(d.cor, '')) like '%' || q || '%'
  order by po.criado_em desc
  limit greatest(1, least(coalesce(p_limite, 200), 1000));
end $$;

-- ---------- Permissões ----------

revoke execute on function
  public.pombos_visiveis(), public.pode_editar_pombo(uuid), public.meus_pombos(),
  public.garantir_meus_dados(uuid, text), public.pombo_da_anilha(jsonb, text), public.apagar_se_orfao(uuid),
  public.salvar_pombo(jsonb), public.remover_do_plantel(uuid, boolean), public.filhos_do_pombo(uuid),
  public.uuid_ou_nulo(text), public.minhas_fotos_total(), public.definir_foto(uuid, text, text),
  public.admin_resumo(), public.admin_plantel_do_usuario(uuid), public.admin_pombos(text, int)
  from public, anon;
revoke execute on function
  public.garantir_meus_dados(uuid, text), public.pombo_da_anilha(jsonb, text), public.apagar_se_orfao(uuid)
  from authenticated;
grant execute on function
  public.pombos_visiveis(), public.pode_editar_pombo(uuid), public.meus_pombos(),
  public.salvar_pombo(jsonb), public.remover_do_plantel(uuid, boolean), public.filhos_do_pombo(uuid),
  public.uuid_ou_nulo(text), public.minhas_fotos_total(), public.definir_foto(uuid, text, text),
  public.admin_resumo(), public.admin_plantel_do_usuario(uuid), public.admin_pombos(text, int)
  to authenticated;
