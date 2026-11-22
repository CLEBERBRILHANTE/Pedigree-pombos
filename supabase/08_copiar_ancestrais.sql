-- Passo 8: copiar os ancestrais de um pombo que outro criador já cadastrou (ex.: pombo comprado).
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 07_historico_permanente.sql. Pode rodar de novo sem problema.
--
-- O que muda:
--  * Ao cadastrar uma anilha que outro criador já cadastrou com pai ou mãe, o app oferece
--    "Copiar os ancestrais". A cópia traz nome, sexo, cor, nascimento, pai e mãe do pombo e dos
--    ancestrais até os trisavós (as 5 gerações do pedigree).
--  * A cópia é SUA: você pode mudar o que quiser, e nada muda no cadastro do outro criador.
--  * Só preenche o que está em branco nos seus dados. O que você já digitou não é trocado.
--  * Fotos, observações e dados do outro criador (nome, e-mail, telefone) NÃO são copiados.

do $$
begin
  if to_regclass('public.dados_pombo') is null then
    raise exception 'Rode primeiro o 06_seguranca_dados_por_usuario.sql.';
  end if;
end $$;

-- De quem copiar: outro criador que cadastrou pai ou mãe deste pombo.
-- Prefere quem tem (ou teve) o pombo no plantel, depois quem cadastrou a anilha primeiro.
create or replace function public.fonte_dos_ancestrais(p uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select d.user_id
  from public.dados_pombo d
  left join public.plantel pl on pl.user_id = d.user_id and pl.pombo_id = d.pombo_id
  where d.pombo_id = p and d.user_id <> auth.uid() and (d.pai_id is not null or d.mae_id is not null)
  order by (pl.situacao is not null and pl.situacao <> 'referencia') desc,
           (d.user_id = (select criado_por from public.pombos where id = p)) desc,
           (d.nome is not null) desc, d.atualizado_em desc
  limit 1
$$;

-- Procura a anilha enquanto o usuário digita. Agora diz também se dá para copiar os ancestrais.
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
    'registros', (select count(*) from public.eventos where pombo_id = v_id),
    'pode_copiar', public.fonte_dos_ancestrais(v_id) is not null);
end $$;

-- Copia para o usuário os dados e os ancestrais do pombo (até os trisavós) a partir do cadastro de outro criador.
-- Só preenche o que está em branco. Devolve quantos pombos foram copiados ou completados.
create or replace function public.copiar_ancestrais(p_pombo uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v_src uuid;
  fila uuid[]; niveis int[];
  vistos uuid[] := '{}';
  i int := 1;
  x uuid; n int;
  s public.dados_pombo;
  m public.dados_pombo;
  v_pai uuid; v_mae uuid;
  v_total int := 0;
begin
  if uid is null then raise exception 'Sua sessão expirou. Entre de novo.'; end if;
  if not public.tem_no_plantel(p_pombo) then raise exception 'Este pombo não está no seu plantel.'; end if;
  v_src := public.fonte_dos_ancestrais(p_pombo);
  if v_src is null then return 0; end if;
  if (select count(*) from public.plantel where user_id = uid) >= 4970 then
    raise exception 'Você está perto do limite de 5.000 pombos no plantel.';
  end if;

  fila := array[p_pombo]; niveis := array[0];
  while i <= coalesce(array_length(fila, 1), 0) loop
    x := fila[i]; n := niveis[i]; i := i + 1;
    if x = any(vistos) then continue; end if;
    vistos := vistos || x;

    select * into s from public.dados_pombo where user_id = v_src and pombo_id = x;
    if not found then continue; end if;
    select * into m from public.dados_pombo where user_id = uid and pombo_id = x;

    -- Pai e mãe do outro criador entram só onde os meus estão em branco (até os trisavós).
    v_pai := m.pai_id; v_mae := m.mae_id;
    if n < 4 and v_pai is null and s.pai_id is not null and s.pai_id <> x
       and not exists (select 1 from public.dados_pombo where user_id = uid and pombo_id = s.pai_id and sexo = 'F') then
      v_pai := s.pai_id;
      insert into public.dados_pombo (user_id, pombo_id, sexo) values (uid, s.pai_id, 'M') on conflict do nothing;
      update public.dados_pombo set sexo = 'M' where user_id = uid and pombo_id = s.pai_id and sexo is null;
    end if;
    if n < 4 and v_mae is null and s.mae_id is not null and s.mae_id <> x and s.mae_id is distinct from v_pai
       and not exists (select 1 from public.dados_pombo where user_id = uid and pombo_id = s.mae_id and sexo = 'M') then
      v_mae := s.mae_id;
      insert into public.dados_pombo (user_id, pombo_id, sexo) values (uid, s.mae_id, 'F') on conflict do nothing;
      update public.dados_pombo set sexo = 'F' where user_id = uid and pombo_id = s.mae_id and sexo is null;
    end if;

    if m.pombo_id is null then
      insert into public.dados_pombo (user_id, pombo_id, nome, sexo, cor, nascimento, pai_id, mae_id)
      values (uid, x, s.nome, s.sexo, s.cor, s.nascimento, v_pai, v_mae)
      on conflict (user_id, pombo_id) do update set
        nome = coalesce(public.dados_pombo.nome, excluded.nome),
        sexo = coalesce(public.dados_pombo.sexo, excluded.sexo),
        cor = coalesce(public.dados_pombo.cor, excluded.cor),
        nascimento = coalesce(public.dados_pombo.nascimento, excluded.nascimento),
        pai_id = coalesce(public.dados_pombo.pai_id, excluded.pai_id),
        mae_id = coalesce(public.dados_pombo.mae_id, excluded.mae_id);
    else
      update public.dados_pombo set
        nome = coalesce(nome, s.nome), sexo = coalesce(sexo, s.sexo), cor = coalesce(cor, s.cor),
        nascimento = coalesce(nascimento, s.nascimento), pai_id = v_pai, mae_id = v_mae
      where user_id = uid and pombo_id = x;
    end if;
    v_total := v_total + 1;

    -- Ancestrais entram no plantel como "Ancestral" (assim dá para editar a cópia).
    if n > 0 then
      insert into public.plantel (user_id, pombo_id, situacao) values (uid, x, 'referencia')
      on conflict (user_id, pombo_id) do nothing;
    end if;

    -- Segue subindo só pelos ancestrais que vieram do mesmo criador.
    if n < 4 then
      if v_pai is not null and v_pai = s.pai_id then fila := fila || v_pai; niveis := niveis || (n + 1); end if;
      if v_mae is not null and v_mae = s.mae_id then fila := fila || v_mae; niveis := niveis || (n + 1); end if;
    end if;
  end loop;
  return v_total;
end $$;

revoke execute on function public.fonte_dos_ancestrais(uuid), public.copiar_ancestrais(uuid) from public, anon;
revoke execute on function public.fonte_dos_ancestrais(uuid) from authenticated;
grant execute on function public.copiar_ancestrais(uuid), public.buscar_anilha(text, int, text) to authenticated;

-- Conferência: as duas linhas devem dizer "ok".
select 'copiar ancestrais instalado' as item,
       case when to_regprocedure('public.copiar_ancestrais(uuid)') is not null
             and has_function_privilege('authenticated', 'public.copiar_ancestrais(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.copiar_ancestrais(uuid)', 'execute')
            then 'ok' else 'PROBLEMA' end as situacao
union all
select 'função interna protegida',
       case when not has_function_privilege('authenticated', 'public.fonte_dos_ancestrais(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.fonte_dos_ancestrais(uuid)', 'execute')
            then 'ok' else 'PROBLEMA' end;
