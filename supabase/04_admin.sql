-- Passo 4: tela de administrador.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 03_fotos.sql. Pode rodar de novo sem problema.
--
-- Depois, numa consulta nova do SQL Editor, rode UMA vez (trocando pelo e-mail com que você entra no app):
--     select public.tornar_admin('seu-email@exemplo.com');
--
-- Segurança:
--  * Quem é administrador fica gravado na tabela "administradores", que o app não consegue ler nem alterar.
--  * Só dá para virar administrador rodando o comando acima no SQL Editor (dono do projeto Supabase).
--  * As funções da tela de administrador conferem no banco se quem pediu é administrador.
--    Esconder o botão no app é só visual: a proteção de verdade está aqui.

-- Proteção: depois do 06_seguranca_dados_por_usuario.sql este arquivo não deve ser rodado de novo
-- (ele voltaria as regras antigas). Se aparecer o erro abaixo, está tudo certo: não precisa rodar.
do $$ begin
  if to_regclass('public.dados_pombo') is not null then
    raise exception 'Este arquivo é antigo e não precisa ser rodado de novo: o 06 já foi aplicado.';
  end if;
end $$;

create table if not exists public.administradores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.administradores enable row level security;
-- Sem nenhuma regra de acesso: ninguém lê nem altera pelo app.
revoke all on public.administradores from anon, authenticated;

create or replace function public.sou_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.administradores where user_id = auth.uid())
$$;

-- Só pelo SQL Editor (o app não tem permissão de chamar).
create or replace function public.tornar_admin(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Nenhuma conta com o e-mail %. Crie a conta no app primeiro.', p_email; end if;
  insert into public.administradores (user_id) values (uid) on conflict do nothing;
  return 'Pronto: ' || p_email || ' agora é administrador.';
end $$;

create or replace function public.tirar_admin(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  delete from public.administradores a using auth.users u where u.id = a.user_id and lower(u.email) = lower(trim(p_email));
  return 'Pronto: ' || p_email || ' não é mais administrador.';
end $$;

create or replace function public.exigir_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.sou_admin() then raise exception 'Acesso restrito ao administrador.'; end if;
end $$;

-- Totais do app
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
    'fotos', (select count(foto_olho) + count(foto_cabeca) from public.pombos),
    'fotos_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'fotos')
  ) into r;
  return r;
end $$;

-- Lista de usuários com o pombal e quantos pombos cada um tem
create or replace function public.admin_usuarios()
returns table (id uuid, email text, criado_em timestamptz, ultimo_acesso timestamptz, confirmado boolean,
               nome text, nome_pombal text, cidade text, telefone text,
               ativos bigint, no_plantel bigint, registros bigint, admin boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.exigir_admin();
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null,
         p.nome, p.nome_pombal, p.cidade, p.telefone,
         (select count(*) from public.plantel pl where pl.user_id = u.id and pl.situacao = 'ativo'),
         (select count(*) from public.plantel pl where pl.user_id = u.id),
         (select count(*) from public.eventos e where e.autor_id = u.id and e.tipo in ('prova', 'premio', 'saude', 'reproducao', 'observacao')),
         exists (select 1 from public.administradores a where a.user_id = u.id)
  from auth.users u
  left join public.perfis p on p.id = u.id
  order by u.created_at desc;
end $$;

-- Plantel de um usuário
create or replace function public.admin_plantel_do_usuario(p_usuario uuid)
returns table (pombo_id uuid, anilha text, nome text, sexo text, cor text, situacao text, entrou_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.exigir_admin();
  return query
  select po.id, public.anilha_texto(po.pais, po.ano, po.numero), po.nome, po.sexo, po.cor, pl.situacao, pl.criado_em
  from public.plantel pl join public.pombos po on po.id = pl.pombo_id
  where pl.user_id = p_usuario
  order by (pl.situacao = 'ativo') desc, po.ano desc, po.numero;
end $$;

-- Todos os pombos do app (com busca), e com quem estão
create or replace function public.admin_pombos(p_busca text default '', p_limite int default 200)
returns table (pombo_id uuid, anilha text, nome text, sexo text, cor text, criado_em timestamptz,
               pombais bigint, com_quem text, fotos int)
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(trim(coalesce(p_busca, '')));
begin
  perform public.exigir_admin();
  return query
  select po.id, public.anilha_texto(po.pais, po.ano, po.numero), po.nome, po.sexo, po.cor, po.criado_em,
         (select count(*) from public.plantel pl where pl.pombo_id = po.id and pl.situacao <> 'referencia'),
         (select string_agg(coalesce(nullif(pf.nome_pombal, ''), pf.nome, 'Sem nome'), ', ')
            from public.plantel pl left join public.perfis pf on pf.id = pl.user_id
           where pl.pombo_id = po.id and pl.situacao = 'ativo'),
         (case when po.foto_olho is not null then 1 else 0 end + case when po.foto_cabeca is not null then 1 else 0 end)
  from public.pombos po
  where q = ''
     or lower(public.anilha_texto(po.pais, po.ano, po.numero)) like '%' || q || '%'
     or lower(coalesce(po.nome, '')) like '%' || q || '%'
     or lower(coalesce(po.cor, '')) like '%' || q || '%'
  order by po.criado_em desc
  limit greatest(1, least(coalesce(p_limite, 200), 1000));
end $$;

revoke execute on function public.tornar_admin(text), public.tirar_admin(text) from public, anon, authenticated;
revoke execute on function public.sou_admin(), public.exigir_admin(), public.admin_resumo(), public.admin_usuarios(),
  public.admin_plantel_do_usuario(uuid), public.admin_pombos(text, int) from public, anon;
grant execute on function public.sou_admin(), public.exigir_admin(), public.admin_resumo(), public.admin_usuarios(),
  public.admin_plantel_do_usuario(uuid), public.admin_pombos(text, int) to authenticated;
