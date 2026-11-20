-- Passo 3: fotos do olho e da cabeça dos pombos.
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro e clique em "Run".
-- Rode DEPOIS do 02_plantel_historico.sql. Pode rodar de novo sem problema.
--
-- Como funciona:
--  * As fotos ficam no Supabase Storage, numa pasta "fotos" privada (não é pública na internet).
--    Cada pombo tem sua subpasta: fotos/<id do pombo>/olho-....jpg e cabeca-....jpg
--  * O app reduz e comprime a foto no celular antes de enviar (cerca de 100 a 300 KB cada).
--    O plano grátis do Supabase dá 1 GB, o que cabe alguns milhares de fotos.
--  * Quem vê: todos que podem ver o pombo (quem tem o pombo ou um descendente dele no plantel),
--    igual ao histórico compartilhado.
--  * Quem troca ou apaga: as mesmas pessoas que podem mudar nome, cor e pais do pombo
--    (quem está com ele; se ninguém está, quem o tem no plantel).

-- ---------- Colunas com o caminho de cada foto ----------
alter table public.pombos add column if not exists foto_olho text;
alter table public.pombos add column if not exists foto_cabeca text;

-- ---------- Pasta de fotos (bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Lê o id do pombo no começo do caminho da foto ("<id>/olho-123.jpg"). Devolve vazio se não for um id.
create or replace function public.pombo_da_foto(caminho text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(caminho, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then split_part(caminho, '/', 1)::uuid end
$$;

-- ---------- Regras de acesso às fotos ----------
drop policy if exists "fotos: ver" on storage.objects;
create policy "fotos: ver" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and public.pombo_da_foto(name) in (select public.pombos_visiveis()));

drop policy if exists "fotos: enviar" on storage.objects;
create policy "fotos: enviar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos' and public.pode_editar_pombo(public.pombo_da_foto(name)));

drop policy if exists "fotos: trocar" on storage.objects;
create policy "fotos: trocar" on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos' and public.pode_editar_pombo(public.pombo_da_foto(name)))
  with check (bucket_id = 'fotos' and public.pode_editar_pombo(public.pombo_da_foto(name)));

drop policy if exists "fotos: apagar" on storage.objects;
create policy "fotos: apagar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos' and public.pode_editar_pombo(public.pombo_da_foto(name)));

-- ---------- Função usada pelo app para gravar qual é a foto atual ----------
-- p_tipo: 'olho' ou 'cabeca'. p_caminho vazio = remover a foto.
-- Devolve o caminho da foto anterior (o app apaga o arquivo antigo).
create or replace function public.definir_foto(p_pombo uuid, p_tipo text, p_caminho text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  anterior text;
  caminho text := nullif(trim(coalesce(p_caminho, '')), '');
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  if p_tipo not in ('olho', 'cabeca') then raise exception 'Tipo de foto inválido.'; end if;
  if not public.pode_editar_pombo(p_pombo) then
    raise exception 'Só quem está com o pombo pode trocar as fotos dele.';
  end if;
  if caminho is not null and public.pombo_da_foto(caminho) is distinct from p_pombo then
    raise exception 'Caminho da foto inválido.';
  end if;
  if p_tipo = 'olho' then
    select foto_olho into anterior from public.pombos where id = p_pombo for update;
    update public.pombos set foto_olho = caminho where id = p_pombo;
  else
    select foto_cabeca into anterior from public.pombos where id = p_pombo for update;
    update public.pombos set foto_cabeca = caminho where id = p_pombo;
  end if;
  if caminho is distinct from anterior then
    insert into public.eventos (pombo_id, autor_id, tipo, data, descricao)
    values (p_pombo, auth.uid(), 'alteracao', current_date,
            case when caminho is null then 'Foto ' || case p_tipo when 'olho' then 'do olho' else 'da cabeça' end || ' removida'
                 when anterior is null then 'Foto ' || case p_tipo when 'olho' then 'do olho' else 'da cabeça' end || ' adicionada'
                 else 'Foto ' || case p_tipo when 'olho' then 'do olho' else 'da cabeça' end || ' trocada' end);
  end if;
  return anterior;
end $$;

revoke execute on function public.definir_foto(uuid, text, text) from public, anon;
grant execute on function public.definir_foto(uuid, text, text), public.pombo_da_foto(text) to authenticated;
