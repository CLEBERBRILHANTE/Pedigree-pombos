# Pedigree Grátis

App gratuito para columbófilos: cadastro do plantel de pombos e emissão de pedigree com a árvore genealógica.

Criado por **Cleber Felipe Brilhante**.

## Como funciona

- Site estático (HTML, CSS e JavaScript, sem etapa de build). Pode ser publicado no Vercel, Netlify ou GitHub Pages.
- Login e banco de dados no [Supabase](https://supabase.com). Cada usuário só acessa os próprios dados (Row Level Security).
- Configuração pública (URL e chave publicável do Supabase) em `js/config.js`.
- Scripts do banco em `supabase/`, numerados na ordem em que devem ser rodados no SQL Editor do Supabase.

## Estrutura

| Pasta/arquivo | O que tem |
|---|---|
| `index.html` | Página única do app |
| `css/style.css` | Visual |
| `js/app.js` | Telas e lógica (login, cadastro, conta) |
| `js/config.js` | Nome do app, criador e dados do Supabase |
| `vendor/supabase.js` | Biblioteca oficial do Supabase (supabase-js 2.119.2) |
| `supabase/01_base_login.sql` | Tabela `perfis` e regras de segurança |

## Etapas

1. Base e login ✅
2. Cadastro do plantel
3. Pedigree em PDF
4. Fotos do olho e da cabeça, leitura de pedigrees em foto/PDF
