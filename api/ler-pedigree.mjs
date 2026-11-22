// Servidor (Vercel): lê um pedigree em foto ou PDF com a IA da Anthropic (Claude)
// e devolve os pombos encontrados para o app mostrar a prévia.
//
// A chave da Anthropic fica só aqui no servidor, na variável de ambiente ANTHROPIC_API_KEY da Vercel.
// O limite de leituras por usuário é conferido no Supabase (supabase/10_leitura_ia.sql).
import Anthropic from '@anthropic-ai/sdk';

// Dados públicos do Supabase (os mesmos de js/config.js).
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mgijombqhigcfmjcmdsm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_FSWsne-GlT1Uxkd3iFOVhQ_5zImcZQo';

// Modelo padrão (barato). Dá para trocar na Vercel com a variável MODELO_IA.
const MODELO_PADRAO = process.env.MODELO_IA || 'claude-haiku-5-5';
// O administrador pode testar outro modelo pela tela.
const MODELOS_ADMIN = ['claude-haiku-5-5', 'claude-sonnet-5-5'];

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 3 * 1024 * 1024;

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pombos', 'aviso'],
  properties: {
    aviso: { type: 'string', description: 'Problema na leitura (imagem cortada, borrada, não é pedigree). Vazio se estiver tudo bem.' },
    pombos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['posicao', 'numero', 'ano', 'pais', 'nome', 'sexo', 'cor', 'nascimento', 'observacoes'],
        properties: {
          posicao: { type: 'integer', description: '1 = pombo do pedigree, 2 = pai, 3 = mãe; pai de n = 2n, mãe de n = 2n+1 (até 31).' },
          numero: { type: 'string' },
          ano: { type: 'string', description: 'Ano da anilha com 2 ou 4 dígitos.' },
          pais: { type: 'string', description: 'Sigla do país da anilha.' },
          nome: { type: 'string' },
          sexo: { type: 'string', enum: ['M', 'F', ''] },
          cor: { type: 'string' },
          nascimento: { type: 'string', description: 'AAAA-MM-DD ou vazio.' },
          observacoes: { type: 'string' }
        }
      }
    }
  }
};

const INSTRUCOES = `Você lê pedigrees de pombos-correio (columbofilia) e transcreve os pombos para cadastro num app brasileiro.

Como o pedigree é organizado:
- Em geral é uma árvore da esquerda para a direita: o pombo principal à esquerda; na coluna seguinte o pai (em cima) e a mãe (embaixo); depois avós, bisavós e trisavós. Alguns pedigrees vêm de cima para baixo, mas a ideia é a mesma: o pai sempre antes da mãe.
- Numere cada quadro assim: 1 = pombo principal, 2 = pai, 3 = mãe. O pai do pombo n é 2n e a mãe é 2n+1. Ex.: 4 = pai do pai, 5 = mãe do pai, 6 = pai da mãe, 7 = mãe da mãe, 8 a 15 bisavós, 16 a 31 trisavós.
- Confira a posição pelo desenho das linhas e pelo alinhamento dos quadros. Pai é macho e mãe é fêmea: posições pares são machos, ímpares (menos a 1) são fêmeas.
- Deixe de fora quadros vazios, sem anilha, e tudo além da 5ª geração (posição maior que 31).

Anilha (o mais importante: copie com cuidado, dígito por dígito):
- numero: como está escrito, com zeros à esquerda e hífens (ex.: "01769-55", "1369281", "6255864").
- ano: os 2 ou 4 dígitos do ano (ex.: "08", "2021").
- pais: use estas siglas: BRA, ARG, URU, PAR, BEL, ALE, HOL, POR, FRA, ESP, ITA, ING, POL, CHN, USA. Converta: DV/D/GER/DE = ALE; NL = HOL; B/BE = BEL; P/PT = POR; F/FR = FRA; E/ES = ESP; I/IT = ITA; GB = ING; PL = POL; BR = BRA. Se não houver país, use BRA. Outro país: a sigla que aparecer (2 a 4 letras).
- Formatos comuns: "01769-55/08 ALE" -> numero "01769-55", ano "08", pais "ALE". "DV-01769-08-55" -> numero "01769-55", ano "08", pais "ALE". "BE 6255864/99" ou "B-99-6255864" -> numero "6255864", ano "99", pais "BEL". "NL 2015-1234567" -> numero "1234567", ano "2015", pais "HOL".

Outros campos (deixe vazio o que não estiver escrito; não invente):
- nome: o nome do pombo, sem aspas (ex.: "SUPERSTAR MESSI").
- sexo: "M" ou "F" (Macho/Fêmea, Male/Female, Doffer/Duivin, Man/Weib, ♂/♀, Mâle/Femelle).
- cor: a cor/plumagem, em português se der (ex.: Azul barrado, Azul xadrez, Azul mosqueado, Ardósia, Vermelho, Vermelho xadrez, Mosqueado, Preto, Branco, Pintado, Fumaça).
- nascimento: só se a data estiver escrita, no formato AAAA-MM-DD.
- observacoes: o texto do quadro (títulos, prêmios, linhagem, criador), transcrito no idioma original, sem repetir anilha, nome, sexo e cor. Junte as linhas com espaço. No máximo uns 600 caracteres.

Se a imagem não for um pedigree, ou estiver ilegível, devolva a lista vazia e explique em "aviso" em português simples. Se só uma parte estiver ilegível, transcreva o resto e diga em "aviso" o que ficou duvidoso.`;

const txt = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function limparPombos(lista) {
  const vistos = new Set();
  const saida = [];
  for (const p of Array.isArray(lista) ? lista : []) {
    const pos = Number(p && p.posicao);
    if (!Number.isInteger(pos) || pos < 1 || pos > 31 || vistos.has(pos)) continue;
    const numero = txt(p.numero, 30);
    if (!numero) continue;
    vistos.add(pos);
    const ano = txt(p.ano, 4).replace(/\D/g, '');
    const pais = txt(p.pais, 4).toUpperCase().replace(/[^A-Z]/g, '') || 'BRA';
    const nasc = /^\d{4}-\d{2}-\d{2}$/.test(txt(p.nascimento, 10)) ? txt(p.nascimento, 10) : '';
    saida.push({
      posicao: pos, numero, ano, pais,
      nome: txt(p.nome, 80).replace(/^["'“”]+|["'“”]+$/g, ''),
      sexo: pos === 1 ? (['M', 'F'].includes(p.sexo) ? p.sexo : '') : (pos % 2 === 0 ? 'M' : 'F'),
      cor: txt(p.cor, 60),
      nascimento: nasc,
      observacoes: txt(p.observacoes, 2000)
    });
  }
  return saida.sort((a, b) => a.posicao - b.posicao);
}

// Chama uma função (RPC) do Supabase em nome do usuário logado.
async function rpc(nome, token, corpo = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (dados && (dados.message || dados.msg)) || `Erro ${r.status}`;
    const e = new Error(r.status === 401 || /JWT/i.test(msg) ? 'Sua sessão expirou. Entre de novo.' : msg);
    e.status = r.status === 401 ? 401 : 400;
    throw e;
  }
  return dados;
}

export default async function handler(req, res) {
  const responder = (status, corpo) => res.status(status).json(corpo);
  if (req.method !== 'POST') return responder(405, { erro: 'Use POST.' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return responder(503, { erro: 'A leitura com IA ainda não foi ativada no servidor (falta a chave da Anthropic na Vercel).' });
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return responder(401, { erro: 'Entre na sua conta para usar a leitura com IA.' });

  const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const tipo = String(corpo.tipo || '');
  const dados = String(corpo.arquivo || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!TIPOS.includes(tipo)) return responder(400, { erro: 'Envie uma foto (JPG, PNG) ou um PDF.' });
  if (!dados) return responder(400, { erro: 'Nenhum arquivo enviado.' });
  if (dados.length * 0.75 > MAX_BYTES) return responder(413, { erro: 'Arquivo grande demais. O limite é 3 MB.' });

  // Confere o limite do usuário e já conta a leitura.
  let leitura;
  try {
    leitura = await rpc('iniciar_leitura_ia', token);
  } catch (e) {
    const msg = /could not find the function|schema cache/i.test(e.message)
      ? 'Falta rodar o arquivo 10_leitura_ia.sql no Supabase.' : e.message;
    return responder(e.status === 401 ? 401 : 429, { erro: msg });
  }

  const modelo = leitura.admin && MODELOS_ADMIN.includes(corpo.modelo) ? corpo.modelo : MODELO_PADRAO;
  const devolver = () => rpc('concluir_leitura_ia', token, { p_leitura: leitura.leitura, p_ok: false }).catch(() => {});

  const arquivo = tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dados } }
    : { type: 'image', source: { type: 'base64', media_type: tipo, data: dados } };

  const client = new Anthropic(); // usa ANTHROPIC_API_KEY
  let resposta;
  try {
    resposta = await client.messages.create({
      model: modelo,
      max_tokens: 16000,
      system: INSTRUCOES,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
      messages: [{ role: 'user', content: [arquivo, { type: 'text', text: 'Transcreva os pombos deste pedigree.' }] }]
    });
  } catch (e) {
    await devolver();
    console.error('Erro na Anthropic:', e && e.status, e && e.message);
    if (e instanceof Anthropic.AuthenticationError) return responder(503, { erro: 'A chave da Anthropic na Vercel está errada ou foi apagada. Avise o administrador.' });
    if (e instanceof Anthropic.PermissionDeniedError) return responder(503, { erro: 'A conta da Anthropic não tem permissão para este modelo. Avise o administrador.' });
    if (e instanceof Anthropic.BadRequestError) {
      const semCredito = /credit|billing|balance/i.test(e.message || '');
      return responder(semCredito ? 503 : 400, { erro: semCredito ? 'Acabou o crédito da leitura com IA. Avise o administrador.' : 'A IA não conseguiu abrir este arquivo. Tente uma foto mais nítida ou outro PDF.' });
    }
    if (e instanceof Anthropic.RateLimitError) return responder(429, { erro: 'Muitas leituras ao mesmo tempo. Espere um minuto e tente de novo.' });
    if (e instanceof Anthropic.APIError) return responder(502, { erro: 'A IA está fora do ar agora. Tente de novo em alguns minutos.' });
    return responder(502, { erro: 'Não foi possível falar com a IA. Tente de novo.' });
  }

  if (resposta.stop_reason === 'refusal') {
    await devolver();
    return responder(422, { erro: 'A IA não quis ler este arquivo. Tente outra foto do pedigree.' });
  }
  const texto = resposta.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let lido;
  try { lido = JSON.parse(texto); } catch (e) { lido = null; }
  if (!lido) {
    await devolver();
    return responder(502, { erro: resposta.stop_reason === 'max_tokens' ? 'O pedigree tem texto demais para ler de uma vez.' : 'A IA respondeu de um jeito inesperado. Tente de novo.' });
  }

  const pombos = limparPombos(lido.pombos);
  const u = resposta.usage || {};
  await rpc('concluir_leitura_ia', token, {
    p_leitura: leitura.leitura, p_ok: true, p_modelo: modelo,
    p_entrada: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    p_saida: u.output_tokens || 0, p_pombos: pombos.length
  }).catch(() => {});

  return responder(200, {
    pombos,
    aviso: txt(lido.aviso, 500),
    modelo,
    restam: leitura.admin ? null : {
      hoje: Math.max(0, leitura.limite_dia - leitura.hoje - 1),
      mes: Math.max(0, leitura.limite_mes - leitura.mes - 1)
    }
  });
}
