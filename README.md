# Pedigree Grátis

App gratuito para columbófilos: cadastro do plantel de pombos e emissão de pedigree com a árvore genealógica.

App desenvolvido por **Cleber Felipe Brilhante**.

## Como funciona

- Site estático (HTML, CSS e JavaScript, sem etapa de build). Pode ser publicado no Vercel, Netlify ou GitHub Pages.
- Login e banco de dados no [Supabase](https://supabase.com). Cada usuário só acessa o próprio plantel (Row Level Security).
- Histórico compartilhado: a anilha (país + ano + número) identifica o pombo no app todo. Quem cadastra uma anilha que já existe passa a ver o histórico completo do pombo (nascimento, pombais por onde passou, provas e resultados, saúde, reprodução, observações).
- Pedigree em PDF: tela Pedigree (ou botão na ficha do pombo). Usa os pombos e pais já cadastrados; o texto de cada quadro vem de "Títulos e observações". Não precisa rodar SQL novo.
- Fotos do olho e da cabeça: na ficha do pombo. O app diminui a foto (máx. 1280 px, JPEG) antes de enviar. Quem vê o pombo vê as fotos; quem pode mudar os dados do pombo pode trocá-las. Podem sair no pedigree em PDF.
- Configuração pública (URL e chave publicável do Supabase) em `js/config.js`.
- Scripts do banco em `supabase/`, numerados na ordem em que devem ser rodados no SQL Editor do Supabase.

## Estrutura

| Pasta/arquivo | O que tem |
|---|---|
| `index.html` | Página única do app |
| `css/style.css` | Visual |
| `js/app.js` | Telas e lógica (login, conta, plantel, ficha, histórico) |
| `js/config.js` | Nome do app, criador e dados do Supabase |
| `vendor/supabase.js` | Biblioteca oficial do Supabase (supabase-js 2.119.2) |
| `vendor/jspdf.umd.min.js` | Gerador de PDF no navegador (jsPDF 3.0.3), carregado só na hora de baixar o pedigree |
| `supabase/01_base_login.sql` | Tabela `perfis` e regras de segurança |
| `supabase/02_plantel_historico.sql` | Tabelas `pombos`, `plantel` e `eventos`, regras do histórico compartilhado |
| `supabase/03_fotos.sql` | Pasta privada `fotos` no Storage, regras de acesso e função `definir_foto` |

## Etapas

1. Base e login ✅
2. Cadastro do plantel e histórico compartilhado ✅
3. Pedigree em PDF ✅ (5 gerações, folha A4, gerado no próprio navegador, sem servidor)
4. Fotos do olho e da cabeça ✅ (Supabase Storage, pasta privada, fotos comprimidas no navegador)
5. Tela de administrador
6. Leitura de pedigrees em foto/PDF (adiada)
