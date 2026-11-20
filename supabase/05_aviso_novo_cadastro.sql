-- Passo 5 (opcional): e-mail de aviso a cada nova conta criada no app.
-- Usa o Resend (resend.com), grátis até 100 e-mails por dia.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Pode rodar de novo sem problema.
--
-- Depois, numa consulta nova do SQL Editor, rode UMA vez com a sua chave do Resend e o seu e-mail
-- (o mesmo e-mail com que você criou a conta no Resend):
--     select public.configurar_aviso_email('re_SUA_CHAVE', 'seu-email@exemplo.com');
-- Para testar:
--     select public.testar_aviso_email();
-- Para desligar o aviso:
--     select public.configurar_aviso_email('', '');
--
-- A chave fica guardada no cofre do Supabase (Vault), fora do código e fora do app.
-- Se o envio falhar, a criação da conta continua normal (o aviso nunca atrapalha o cadastro).

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Guarda (ou troca) a chave do Resend e o e-mail que recebe os avisos. Só pelo SQL Editor.
create or replace function public.configurar_aviso_email(p_chave text, p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  nomes constant text[] := array['resend_api_key', 'aviso_email_para'];
  valores text[] := array[trim(coalesce(p_chave, '')), trim(coalesce(p_email, ''))];
  sid uuid;
begin
  for i in 1..2 loop
    select id into sid from vault.secrets where name = nomes[i];
    if sid is null then
      perform vault.create_secret(valores[i], nomes[i]);
    else
      perform vault.update_secret(sid, valores[i]);
    end if;
    sid := null;
  end loop;
  if valores[1] = '' or valores[2] = '' then return 'Aviso por e-mail desligado.'; end if;
  return 'Aviso por e-mail ligado para ' || valores[2] || '.';
end $$;

-- Monta e envia o e-mail pelo Resend (o envio acontece em segundo plano).
create or replace function public.enviar_aviso_email(p_assunto text, p_html text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare chave text; para text;
begin
  select decrypted_secret into chave from vault.decrypted_secrets where name = 'resend_api_key';
  select decrypted_secret into para from vault.decrypted_secrets where name = 'aviso_email_para';
  if coalesce(chave, '') = '' or coalesce(para, '') = '' then return false; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || chave, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Pedigree Grátis <onboarding@resend.dev>',
      'to', jsonb_build_array(para),
      'subject', p_assunto,
      'html', p_html)
  );
  return true;
end $$;

create or replace function public.avisar_novo_cadastro()
returns trigger language plpgsql security definer set search_path = '' as $$
declare total bigint;
begin
  begin
    select count(*) into total from auth.users;
    perform public.enviar_aviso_email(
      'Novo cadastro no Pedigree Grátis: ' || coalesce(new.email, 'sem e-mail'),
      '<p><b>Nova conta criada no Pedigree Grátis.</b></p>'
      || '<p>Nome: ' || coalesce(replace(replace(new.raw_user_meta_data ->> 'nome', '<', '&lt;'), '>', '&gt;'), '(não informado)') || '<br>'
      || 'Pombal: ' || coalesce(replace(replace(new.raw_user_meta_data ->> 'nome_pombal', '<', '&lt;'), '>', '&gt;'), '(não informado)') || '<br>'
      || 'E-mail: ' || coalesce(new.email, '') || '<br>'
      || 'Data: ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '</p>'
      || '<p>Total de contas no app: ' || total || '</p>'
      || '<p><a href="https://pedigreegratis.vercel.app/#/admin">Abrir a tela de administrador</a></p>');
  exception when others then
    null; -- nunca atrapalhar o cadastro
  end;
  return new;
end $$;

drop trigger if exists avisar_novo_cadastro on auth.users;
create trigger avisar_novo_cadastro after insert on auth.users
  for each row execute function public.avisar_novo_cadastro();

-- Manda um e-mail de teste agora.
create or replace function public.testar_aviso_email()
returns text language plpgsql security definer set search_path = '' as $$
begin
  if public.enviar_aviso_email('Teste do aviso do Pedigree Grátis',
       '<p>Se você recebeu este e-mail, o aviso de novos cadastros está funcionando.</p>') then
    return 'E-mail de teste enviado. Confira sua caixa de entrada (e o spam) em 1 minuto.';
  end if;
  return 'Falta configurar: rode select public.configurar_aviso_email(''re_SUA_CHAVE'', ''seu-email'');';
end $$;

revoke execute on function public.configurar_aviso_email(text, text), public.enviar_aviso_email(text, text),
  public.testar_aviso_email(), public.avisar_novo_cadastro() from public, anon, authenticated;
