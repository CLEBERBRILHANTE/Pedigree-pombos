-- Conferência de segurança (só leitura: não muda nada no banco).
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo e clique em "Run".
-- Resultado esperado: TODAS as linhas com "ok" na coluna "situacao".

with funcoes as (
  select p.proname as nome,
         has_function_privilege('anon', p.oid, 'execute') as visitante,
         has_function_privilege('authenticated', p.oid, 'execute') as usuario
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
),
proibidas as (
  select unnest(array['tornar_admin', 'tirar_admin', 'configurar_aviso_email', 'enviar_aviso_email',
                      'testar_aviso_email', 'pombo_da_anilha', 'apagar_se_orfao', 'garantir_meus_dados',
                      'fonte_dos_ancestrais']) as nome
)
select * from (
select 'função ' || f.nome as item,
       case when f.visitante then 'PROBLEMA: visitante sem login consegue usar'
            when f.usuario and f.nome in (select nome from proibidas) then 'PROBLEMA: qualquer usuário consegue usar'
            else 'ok' end as situacao
from funcoes f
union all
select 'tabela ' || c.relname,
       case when c.relrowsecurity then 'ok' else 'PROBLEMA: sem regras de acesso (RLS)' end
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
union all
select 'pasta de fotos',
       case when exists (select 1 from storage.buckets where id = 'fotos' and public = false) then 'ok'
            else 'PROBLEMA: pasta de fotos pública ou inexistente' end
union all
select 'dados por usuário (arquivo 06)',
       case when to_regclass('public.dados_pombo') is not null then 'ok' else 'PROBLEMA: falta rodar o 06' end
) r
order by situacao = 'ok', item;
