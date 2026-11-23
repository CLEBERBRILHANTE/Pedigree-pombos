# Pedigree Grátis

App gratuito para columbófilos: cadastro do plantel de pombos e emissão de pedigree com a árvore genealógica.

App desenvolvido por **Cleber Felipe Brilhante**.

## Como funciona

- Site estático (HTML, CSS e JavaScript, sem etapa de build). Pode ser publicado no Vercel, Netlify ou GitHub Pages.
- Login e banco de dados no [Supabase](https://supabase.com). Cada usuário só acessa o próprio plantel (Row Level Security).
- Dados de cada usuário: nome, sexo, cor, nascimento, pai, mãe e fotos de cada pombo são só de quem os cadastrou (tabela `dados_pombo`). Se outra pessoa cadastrar a mesma anilha, o que ela mudar aparece só para ela.
- Histórico compartilhado: a anilha (país + ano + número) identifica o pombo no app todo. Quem cadastra uma anilha que já existe passa a ver o histórico do pombo (pombais por onde passou, provas e resultados, saúde, reprodução, observações). Cada registro só pode ser alterado ou apagado por quem o fez, e sai sempre com o nome do pombal do autor.
- Pedigree em PDF: tela Pedigree (ou botão na ficha do pombo). Usa os pombos e pais já cadastrados; o texto de cada quadro vem de "Títulos e observações". Não precisa rodar SQL novo.
- Fotos do olho e da cabeça: na ficha do pombo. O app diminui a foto (máx. 1280 px, JPEG) antes de enviar. Cada usuário vê e troca só as próprias fotos (pasta `fotos/<usuário>/<pombo>/`). Podem sair no pedigree em PDF.
- Pedigree: tocar num quadro vazio abre o cadastro daquele ancestral já ligado ao filho certo; tocar num ancestral abre a edição dele e volta ao pedigree.
- Administrador: menu Admin com totais, lista de usuários/pombais (com o plantel de cada um) e lista de pombos. Para tornar uma conta administradora, rode no SQL Editor `select public.tornar_admin('email-da-conta');`.
- Ler pedigree com IA: a foto ou o PDF vai para `api/ler-pedigree.mjs` (servidor da Vercel), que chama a Anthropic. A chave da Anthropic fica só na Vercel, nunca no navegador. O app mostra uma prévia editável e só cadastra depois que o usuário confirma.
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
| `vendor/jspdf.umd.min.js` | Gerador de PDF no navegador (jsPDF 4.2.1), carregado só na hora de baixar o pedigree |
| `supabase/01_base_login.sql` | Tabela `perfis` e regras de segurança |
| `supabase/02_plantel_historico.sql` | Tabelas `pombos`, `plantel` e `eventos`, regras do histórico compartilhado |
| `supabase/04_admin.sql` | Tabela `administradores` e funções da tela de administrador (protegidas no banco) |
| `supabase/05_aviso_novo_cadastro.sql` | Opcional: e-mail de aviso a cada nova conta (Resend grátis, chave no Vault) |
| `supabase/03_fotos.sql` | Pasta privada `fotos` no Storage, regras de acesso e função `definir_foto` |
| `supabase/06_seguranca_dados_por_usuario.sql` | Correções de segurança: dados e fotos de cada pombo por usuário, autor verdadeiro no histórico, limites de tamanho e quantidade. Depois dele, não rode de novo o 02, 03 e 04 |
| `supabase/07_historico_permanente.sql` | Tirar o pombo do plantel não apaga mais o histórico dele; depois de tirar, os registros ficam guardados sem alteração |
| `supabase/08_copiar_ancestrais.sql` | Ao cadastrar anilha que outro criador já cadastrou, copia os ancestrais dele como cópia própria e editável |
| `supabase/09_vacinas.sql` | Vacinas de cada usuário, vacinação em massa (registra Saúde no histórico) e próximas doses |
| `supabase/10_leitura_ia.sql` | Leitura de pedigree com IA: limite de leituras por usuário (5/dia, 30/mês; admin sem limite) e custo na tela Admin |
| `api/ler-pedigree.mjs` | Função do servidor (Vercel) que manda a foto/PDF para a IA da Anthropic. Precisa da variável `ANTHROPIC_API_KEY` na Vercel; `MODELO_IA` é opcional (padrão `claude-haiku-5-5`) |
| `supabase/conferir_seguranca.sql` | Só leitura: confere se funções, tabelas e pasta de fotos estão protegidas |

## Etapas

1. Base e login ✅
2. Cadastro do plantel e histórico compartilhado ✅
3. Pedigree em PDF ✅ (5 gerações, folha A4, gerado no próprio navegador, sem servidor)
4. Fotos do olho e da cabeça ✅ (Supabase Storage, pasta privada, fotos comprimidas no navegador)
5. Tela de administrador ✅ (só para contas na tabela `administradores`) e aviso por e-mail de novo cadastro
6. Leitura de pedigrees em foto/PDF com IA ✅ (tela `#/ler`: a IA lê, o usuário confere e corrige, e o app cadastra o pombo e os ancestrais ligados)
