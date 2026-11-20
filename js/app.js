(function () {
'use strict';

const C = window.APP_CONFIG;
const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// ---------- Estado ----------
const state = {
  pronto: false,
  session: null,
  perfil: null,
  perfilErro: null,
  auth: 'entrar',         // entrar | criar | esqueci | novaSenha
  authMsg: null,          // { tipo: 'erro' | 'ok', texto }
  ocupado: false,
  dados: { carregado: false, erro: null, plantel: [], pombos: new Map() },
  ficha: { id: null },
  q: '',
  filtro: 'todos',
  histFiltro: 'tudo',
  fotoUrls: new Map(),    // caminho da foto -> { url, ate }
  fotoEnviando: null      // 'olho' | 'cabeca' enquanto envia
};

// Erros que o Supabase devolve no endereço (ex.: link de e-mail vencido).
(function lerErroDoEndereco() {
  const h = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const q = new URLSearchParams(location.search);
  const code = h.get('error_code') || q.get('error_code');
  const desc = h.get('error_description') || q.get('error_description');
  if (code || desc) {
    state.authMsg = { tipo: 'erro', texto: code === 'otp_expired' ? 'Este link expirou ou já foi usado. Peça um novo.' : traduzir(desc || code) };
    history.replaceState(null, '', location.pathname);
  }
  if (h.get('type') === 'recovery') state.auth = 'novaSenha';
})();

// ---------- Utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3000); }

function traduzir(m) {
  const s = String(m || '').toLowerCase();
  if (s.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (s.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Procure a mensagem na sua caixa de entrada (e no spam).';
  if (s.includes('user already registered') || s.includes('already been registered')) return 'Já existe uma conta com este e-mail. Use "Entrar" ou "Esqueci minha senha".';
  if (s.includes('password should be at least') || s.includes('weak_password') || s.includes('password is too weak')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (s.includes('should be different')) return 'A nova senha precisa ser diferente da anterior.';
  if (s.includes('unable to validate email') || s.includes('invalid format') || s.includes('email address') && s.includes('invalid')) return 'Este e-mail não parece válido.';
  if (s.includes('rate limit') || s.includes('too many') || s.includes('security purposes')) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
  if (s.includes('failed to fetch') || s.includes('network')) return 'Sem conexão com o servidor. Verifique sua internet.';
  if (s.includes('signups not allowed')) return 'O cadastro de novas contas está desligado no momento.';
  return 'Algo deu errado: ' + m;
}

const I = {
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><rect x="2" y="9" width="6" height="6" rx="1"/><rect x="16" y="3" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M8 12h4M12 5.5v13M12 5.5h4M12 18.5h4"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
};

const credito = () => `<p class="credit">${esc(C.nomeApp)} · App desenvolvido por <b>${esc(C.criador)}</b></p>`;

// ---------- Telas de acesso ----------
function vAuth() {
  const a = state.auth;
  const msg = state.authMsg ? `<p class="msg ${state.authMsg.tipo}" role="alert">${esc(state.authMsg.texto)}</p>` : '';
  const dis = state.ocupado ? 'disabled' : '';
  let form;
  if (a === 'esqueci') {
    form = `<form class="card" id="f-esqueci">
      <h2>Esqueci minha senha</h2>
      <p class="hint">Digite o e-mail da sua conta. Vamos mandar um link para você criar uma nova senha.</p>
      ${msg}
      <div class="field"><label for="a-email">E-mail</label><input class="input" id="a-email" type="email" required autocomplete="email"></div>
      <button class="btn btn-primary btn-block" type="submit" ${dis}>Enviar link</button>
      <button type="button" class="link" data-auth="entrar">Voltar para entrar</button>
    </form>`;
  } else if (a === 'novaSenha') {
    form = `<form class="card" id="f-novasenha">
      <h2>Criar nova senha</h2>
      ${msg}
      <div class="field"><label for="a-senha">Nova senha</label><input class="input" id="a-senha" type="password" minlength="6" required autocomplete="new-password"></div>
      <button class="btn btn-primary btn-block" type="submit" ${dis}>Salvar nova senha</button>
    </form>`;
  } else {
    const criar = a === 'criar';
    form = `<form class="card" id="f-auth">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-auth="entrar" aria-selected="${!criar}">Entrar</button>
        <button type="button" role="tab" data-auth="criar" aria-selected="${criar}">Criar conta</button>
      </div>
      ${msg}
      ${criar ? `<div class="field"><label for="a-nome">Seu nome</label><input class="input" id="a-nome" required autocomplete="name"></div>
      <div class="field"><label for="a-pombal">Nome do pombal</label><input class="input" id="a-pombal" placeholder="Ex.: Pombal Santa Rita"></div>` : ''}
      <div class="field"><label for="a-email">E-mail</label><input class="input" id="a-email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="a-senha">Senha</label><input class="input" id="a-senha" type="password" minlength="6" required autocomplete="${criar ? 'new-password' : 'current-password'}"></div>
      <button class="btn btn-primary btn-block" type="submit" ${dis}>${state.ocupado ? 'Aguarde…' : criar ? 'Criar conta' : 'Entrar'}</button>
      ${criar ? '<p class="hint">A senha precisa ter pelo menos 6 caracteres. Seu plantel é só seu; o histórico de cada pombo é compartilhado com quem tiver a mesma anilha.</p>' : '<button type="button" class="link" data-auth="esqueci">Esqueci minha senha</button>'}
    </form>`;
  }
  return `<div class="wrap login view">
    <div class="brand"><img src="img/icone.svg" alt=""><h1>${esc(C.nomeApp)}</h1><p>Cadastre seu plantel e emita pedigrees com a árvore completa.</p></div>
    ${form}
    ${credito()}
  </div>`;
}

// ---------- Telas internas ----------
const PAISES = ['BRA', 'ARG', 'URU', 'PAR', 'BEL', 'ALE', 'HOL', 'POR', 'FRA', 'ESP', 'ITA', 'ING', 'POL', 'CHN', 'USA'];
const CORES = ['Azul barrado', 'Azul xadrez', 'Azul mosqueado', 'Ardósia', 'Vermelho', 'Vermelho xadrez', 'Mosqueado', 'Preto', 'Branco', 'Pintado', 'Fumaça'];
const SIT = { ativo: 'No pombal', referencia: 'Ancestral', vendido: 'Vendido', cedido: 'Cedido', perdido: 'Perdido', morto: 'Morreu' };
const SIT_FORM = [['ativo', 'Está no meu pombal'], ['referencia', 'Ancestral (só para o pedigree)'], ['vendido', 'Vendido'], ['cedido', 'Cedido / emprestado a outro pombal'], ['perdido', 'Perdido (não voltou)'], ['morto', 'Morreu']];
const SAIU = ['vendido', 'cedido', 'perdido', 'morto'];
const ORIGEM = [['', 'Não informar'], ['nascido', 'Nasceu no meu pombal'], ['comprado', 'Comprado'], ['ganho', 'Ganhei de presente'], ['emprestado', 'Recebi emprestado'], ['outro', 'Outro']];
const TIPOS = { prova: 'Prova', premio: 'Prêmio / título', saude: 'Saúde / vacina', reproducao: 'Reprodução', observacao: 'Observação', entrada: 'Entrada no pombal', saida: 'Saída do pombal', alteracao: 'Dados alterados', nascimento: 'Nascimento' };
const TIPOS_MANUAIS = ['prova', 'premio', 'saude', 'reproducao', 'observacao'];

const sexoTxt = s => s === 'F' ? 'Fêmea' : s === 'M' ? 'Macho' : 'Sexo não informado';
const sym = s => s === 'F' ? '♀' : s === 'M' ? '♂' : '?';
const anilha = p => p ? `${p.numero}/${String(p.ano % 100).padStart(2, '0')} ${p.pais}` : '';
const dataBR = d => d ? d.split('-').reverse().join('/') : '';
const num = (n, casas = 0) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const pombo = id => (id && state.dados.pombos.get(id)) || null;
const meuRegistro = id => state.dados.plantel.find(r => r.pombo_id === id) || null;
const sexoCls = s => s === 'F' ? 'f' : s === 'M' ? 'm' : 'u';

// "1402317/23 BRA" -> { numero, ano, pais }
function lerAnilha(txt) {
  const s = String(txt || '').trim();
  if (!s) return null;
  const m = /^(.+?)\s*\/\s*(\d{2}|\d{4})\s*([A-Za-z]{2,4})?$/.exec(s);
  if (!m) return { erro: `Não entendi a anilha "${s}". Escreva assim: 1402317/23 BRA` };
  return { numero: m[1].trim(), ano: m[2], pais: (m[3] || 'BRA').toUpperCase() };
}

function rota() {
  const h = location.hash.replace(/^#\/?/, '');
  const [caminho, busca = ''] = h.split('?');
  const partes = caminho.split('/').filter(Boolean);
  const nomes = ['plantel', 'novo', 'pombo', 'editar', 'evento', 'pedigree', 'conta'];
  const nome = nomes.includes(partes[0]) ? partes[0] : 'plantel';
  return { nome, a: partes[1] || null, b: partes[2] || null, q: new URLSearchParams(busca) };
}

function shell(r, titulo, sub, corpo, { voltar = null, direita = '' } = {}) {
  const ativa = ['pombo', 'editar', 'evento'].includes(r) ? 'plantel' : r;
  const aba = (n, ico, label) => `<a href="#/${n}" ${ativa === n ? 'aria-current="page"' : ''}>${ico}<span>${label}</span></a>`;
  return `<header class="topbar wrap">${voltar ? `<a class="icon-btn" href="${voltar}" aria-label="Voltar">${I.back}</a>` : ''}
    <h1>${esc(titulo)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1>${direita}</header>
  <main class="view wrap"><div class="stack">${corpo}${credito()}</div></main>
  <nav class="tabbar" aria-label="Menu">
    <a class="nav-brand" href="#/plantel"><img src="img/icone.svg" alt=""><span>${esc(C.nomeApp)}</span></a>
    ${aba('plantel', I.list, 'Plantel')}${aba('novo', `<span class="plus">${I.plus}</span>`, 'Cadastrar')}${aba('pedigree', I.tree, 'Pedigree')}${aba('conta', I.user, 'Meu pombal')}
    <p class="nav-credit">App desenvolvido por<br><b>${esc(C.criador)}</b></p>
  </nav>`;
}

const nomePombal = () => (state.perfil && state.perfil.nome_pombal) || 'Meu pombal';
const carregandoHtml = '<p class="hint carregando-bloco">Carregando…</p>';
const erroDados = () => state.dados.erro ? `<p class="msg erro" role="alert">${esc(state.dados.erro)}</p>` : '';

// ----- Plantel -----
function filtrarPlantel() {
  const q = state.q.trim().toLowerCase();
  const f = state.filtro;
  return state.dados.plantel.map(r => ({ r, p: pombo(r.pombo_id) })).filter(({ r, p }) => {
    if (!p) return false;
    if (f === 'ativo' && r.situacao !== 'ativo') return false;
    if (f === 'M' && (p.sexo !== 'M' || r.situacao !== 'ativo')) return false;
    if (f === 'F' && (p.sexo !== 'F' || r.situacao !== 'ativo')) return false;
    if (f === 'referencia' && r.situacao !== 'referencia') return false;
    if (f === 'saiu' && !SAIU.includes(r.situacao)) return false;
    if (!q) return true;
    const pai = pombo(p.pai_id), mae = pombo(p.mae_id);
    return [anilha(p), p.numero, p.nome, p.cor, anilha(pai), pai && pai.nome, anilha(mae), mae && mae.nome]
      .some(v => v && String(v).toLowerCase().includes(q));
  }).sort((x, y) => ((y.r.situacao === 'ativo') - (x.r.situacao === 'ativo')) || (y.p.ano - x.p.ano) || x.p.numero.localeCompare(y.p.numero, 'pt-BR', { numeric: true }));
}

function itemPombo(p, r, href) {
  const pai = pombo(p.pai_id), mae = pombo(p.mae_id);
  const tag = r ? `<span class="tag ${r.situacao === 'ativo' ? 'ok' : ''}">${SIT[r.situacao]}</span>` : '';
  return `<li><a class="bird ${sexoCls(p.sexo)}" href="${href || `#/pombo/${p.id}`}">
    <span class="sexbar"></span>
    <span class="body"><span class="ring">${esc(anilha(p))}</span>
      <span class="name">${esc(p.nome || 'Sem nome')}${p.cor ? ` · <span class="cor">${esc(p.cor)}</span>` : ''}</span>
      <span class="meta">Pai <span class="mono">${pai ? esc(anilha(pai)) : '—'}</span> · Mãe <span class="mono">${mae ? esc(anilha(mae)) : '—'}</span></span></span>
    <span class="side"><span class="sexsym ${sexoCls(p.sexo)}" title="${sexoTxt(p.sexo)}">${sym(p.sexo)}</span>${tag}</span>
  </a></li>`;
}

function listaHtml() {
  const l = filtrarPlantel();
  return l.length ? l.map(({ r, p }) => itemPombo(p, r)).join('') : '<li class="empty">Nenhum pombo encontrado.</li>';
}

function vPlantel() {
  const novo = `<a class="icon-btn" href="#/novo" aria-label="Cadastrar pombo">${I.plus}</a>`;
  if (!state.dados.carregado) return shell('plantel', 'Plantel', nomePombal(), erroDados() || carregandoHtml, { direita: novo });
  const todos = state.dados.plantel;
  if (!todos.length) {
    return shell('plantel', 'Plantel', nomePombal(), `${erroDados()}
      <div class="vazio">${I.list}<h2>Nenhum pombo ainda</h2>
        <p>Cadastre seu primeiro pombo pela anilha. Se ele já passou por outro pombal que usa o app, o histórico dele aparece na hora.</p>
        <a class="btn btn-primary" href="#/novo">${I.plus}Cadastrar pombo</a></div>`, { direita: novo });
  }
  const ativos = todos.filter(r => r.situacao === 'ativo').map(r => pombo(r.pombo_id)).filter(Boolean);
  const chip = (v, l) => `<button type="button" class="chip" data-filtro="${v}" aria-pressed="${state.filtro === v}">${l}</button>`;
  return shell('plantel', 'Plantel', nomePombal(), `${erroDados()}
    <div class="stats"><span><b>${ativos.length}</b> no pombal</span><span><b>${ativos.filter(p => p.sexo === 'M').length}</b> machos</span><span><b>${ativos.filter(p => p.sexo === 'F').length}</b> fêmeas</span><span><b>${todos.length}</b> no total</span></div>
    <div class="search">${I.search}<input class="input" id="q" type="search" placeholder="Buscar por anilha, nome, cor ou pais" value="${esc(state.q)}" aria-label="Buscar"></div>
    <div class="chips">${chip('todos', 'Todos')}${chip('ativo', 'No pombal')}${chip('M', '♂ Machos')}${chip('F', '♀ Fêmeas')}${chip('referencia', 'Ancestrais')}${chip('saiu', 'Saíram')}</div>
    <ul class="list" id="lista">${listaHtml()}</ul>`, { direita: novo });
}

// ----- Ficha do pombo -----
function pcard(id, rot, sexo) {
  const p = pombo(id);
  if (!p) return `<div class="pcard unknown ${sexo === 'F' ? 'f' : ''}"><small>${rot}</small><span>Não informado</span></div>`;
  return `<a class="pcard ${sexo === 'F' ? 'f' : ''}" href="#/pombo/${p.id}"><small>${rot}</small><span class="mono">${esc(anilha(p))}</span><span>${esc(p.nome || p.cor || '')}</span></a>`;
}

function linhaProva(e) {
  const partes = [];
  if (e.colocacao) partes.push(`<b>${num(e.colocacao)}º</b>${e.participantes ? ` de ${num(e.participantes)} pombos` : ''}`);
  else if (e.participantes) partes.push(`${num(e.participantes)} pombos`);
  if (e.distancia_km) partes.push(`${num(e.distancia_km, 1)} km`);
  if (e.velocidade) partes.push(`${num(e.velocidade, 3)} m/min`);
  return partes.join(' · ');
}

function itemHistorico(e) {
  const meu = e.autor_id && state.session && e.autor_id === state.session.user.id;
  const editavel = meu && TIPOS_MANUAIS.includes(e.tipo);
  const prova = e.tipo === 'prova';
  const titulo = prova ? (e.prova_nome || 'Prova') : e.tipo === 'nascimento' ? 'Nasceu' : (e.descricao || TIPOS[e.tipo]);
  const autor = !e.autor_pombal ? '' : ['entrada', 'saida'].includes(e.tipo) ? e.autor_pombal : 'Registrado por ' + e.autor_pombal;
  return `<li class="ev ev-${e.tipo}">
    <span class="ev-dot"></span>
    <div class="ev-body">
      <div class="ev-top"><span class="ev-data">${e.data ? dataBR(e.data) : 'Sem data'}</span><span class="ev-tipo">${esc(TIPOS[e.tipo])}</span></div>
      <p class="ev-tit">${esc(titulo)}</p>
      ${prova && linhaProva(e) ? `<p class="ev-prova">${linhaProva(e)}</p>` : ''}
      ${prova && e.descricao ? `<p class="ev-desc">${esc(e.descricao)}</p>` : ''}
      ${autor ? `<p class="ev-autor">${esc(autor)}${meu ? ' (você)' : ''}</p>` : ''}
      ${editavel ? `<a class="link" href="#/evento/${e.pombo_id}/${e.id}">Editar</a>` : ''}
    </div></li>`;
}

function historicoHtml(p) {
  const f = state.ficha;
  let itens = f.eventos.slice();
  if (p.nascimento && !itens.some(e => e.tipo === 'entrada' && /^Nasceu/.test(e.descricao || ''))) itens.unshift({ id: 'nasc', tipo: 'nascimento', data: p.nascimento, descricao: '' });
  itens.sort((a, b) => (a.data || '9999').localeCompare(b.data || '9999') || String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
  const provas = f.eventos.filter(e => e.tipo === 'prova');
  const melhor = provas.filter(e => e.colocacao).reduce((m, e) => Math.min(m, e.colocacao), Infinity);
  const filtros = { tudo: () => true, provas: e => e.tipo === 'prova' || e.tipo === 'premio', saude: e => e.tipo === 'saude', pombais: e => ['nascimento', 'entrada', 'saida'].includes(e.tipo) };
  itens = itens.filter(filtros[state.histFiltro] || filtros.tudo);
  const chip = (v, l) => `<button type="button" class="chip" data-hist="${v}" aria-pressed="${state.histFiltro === v}">${l}</button>`;
  return `${provas.length ? `<p class="resumo"><b>${provas.length}</b> ${provas.length === 1 ? 'prova' : 'provas'}${melhor < Infinity ? ` · melhor colocação <b>${melhor}º</b>` : ''}</p>` : ''}
    <div class="chips">${chip('tudo', 'Tudo')}${chip('provas', 'Provas e prêmios')}${chip('saude', 'Saúde')}${chip('pombais', 'Pombais')}</div>
    ${itens.length ? `<ol class="timeline">${itens.map(itemHistorico).join('')}</ol>` : '<p class="hint">Nada registrado aqui ainda.</p>'}`;
}

// ----- Fotos do olho e da cabeça -----
const TIPOS_FOTO = [['olho', 'Olho'], ['cabeca', 'Cabeça']];
const urlFoto = caminho => { const u = caminho && state.fotoUrls.get(caminho); return u && u.ate > Date.now() ? u.url : null; };

function fotosHtml(p, r, pronto) {
  const pode = !!r && pronto && podeEditarDados(r);
  const slot = (tipo, rot) => {
    const caminho = p['foto_' + tipo], url = urlFoto(caminho), enviando = state.fotoEnviando === tipo;
    const img = enviando ? `<div class="foto-vazia"><span>Enviando…</span></div>`
      : url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Foto ${tipo === 'olho' ? 'do olho' : 'da cabeça'}" loading="lazy"></a>`
      : caminho ? `<div class="foto-vazia"><span>Carregando…</span></div>`
      : `<div class="foto-vazia">${I.camera}<span>Sem foto</span></div>`;
    const botoes = pode && !enviando ? `<div class="foto-acoes">
        <label class="btn btn-ghost btn-sm">${I.camera}${caminho ? 'Trocar' : 'Adicionar'}<input type="file" accept="image/*" data-foto="${tipo}" data-pombo="${esc(p.id)}" hidden></label>
        ${caminho ? `<button type="button" class="link" data-foto-remover="${tipo}" data-pombo="${esc(p.id)}">Remover</button>` : ''}</div>` : '';
    return `<figure class="foto"><figcaption>${rot}</figcaption>${img}${botoes}</figure>`;
  };
  const algum = p.foto_olho || p.foto_cabeca;
  if (!algum && !pode) return '';
  return `<section class="section"><h2>Fotos</h2><div class="fotos">${TIPOS_FOTO.map(([t, l]) => slot(t, l)).join('')}</div>
    ${pode ? '<p class="hint">Tire a foto com boa luz e de perto. O app diminui a foto antes de enviar. Quem tem este pombo no plantel também vê as fotos.</p>' : ''}</section>`;
}

// Gera links temporários (1 hora) para ver as fotos, que ficam numa pasta privada.
async function carregarUrlsFotos(caminhos) {
  const faltam = [...new Set(caminhos.filter(c => c && !urlFoto(c)))];
  if (!faltam.length) return;
  const { data, error } = await sb.storage.from('fotos').createSignedUrls(faltam, 3600);
  if (error || !data) return;
  data.forEach(d => { if (d.signedUrl && d.path) state.fotoUrls.set(d.path, { url: d.signedUrl, ate: Date.now() + 50 * 60 * 1000 }); });
}

function abrirImagem(src) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => falha(new Error('Não consegui abrir esta imagem. Use uma foto JPG ou PNG.'));
    img.src = src;
  });
}

// Diminui a foto para no máximo 1280 px e comprime em JPEG (fica entre 100 e 300 KB).
async function comprimirFoto(arquivo, max = 1280, qualidade = 0.82) {
  let fonte, largura, altura, url;
  try {
    fonte = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    largura = fonte.width; altura = fonte.height;
  } catch (e) {
    url = URL.createObjectURL(arquivo);
    try { fonte = await abrirImagem(url); } finally { URL.revokeObjectURL(url); }
    largura = fonte.naturalWidth; altura = fonte.naturalHeight;
  }
  const escala = Math.min(1, max / Math.max(largura, altura));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largura * escala); canvas.height = Math.round(altura * escala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
  if (fonte.close) fonte.close();
  const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Não consegui preparar a foto. Tente outra imagem.');
  return blob;
}

function erroFoto(m) {
  const s = String(m || '');
  if (/bucket not found|could not find the function|definir_foto/i.test(s)) return 'O banco ainda não está pronto para fotos: falta rodar o arquivo 03_fotos.sql no Supabase.';
  if (/row-level security|unauthorized|403/i.test(s)) return 'Só quem está com o pombo pode trocar as fotos dele.';
  if (/payload too large|exceeded the maximum/i.test(s)) return 'A foto ficou grande demais. Tente outra.';
  return /^(Não|Só|O banco)/.test(s) ? s : traduzir(s);
}

async function enviarFoto(input) {
  const arquivo = input.files && input.files[0];
  const tipo = input.dataset.foto, pid = input.dataset.pombo;
  if (!arquivo) return;
  if (arquivo.type && !arquivo.type.startsWith('image/')) { toast('Escolha um arquivo de imagem.'); return; }
  state.fotoEnviando = tipo; render();
  let caminho = null;
  try {
    const blob = await comprimirFoto(arquivo);
    caminho = `${pid}/${tipo}-${Date.now()}.jpg`;
    const up = await sb.storage.from('fotos').upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (up.error) { caminho = null; throw up.error; }
    const { data: anterior, error } = await sb.rpc('definir_foto', { p_pombo: pid, p_tipo: tipo, p_caminho: caminho });
    if (error) throw error;
    if (anterior && anterior !== caminho) sb.storage.from('fotos').remove([anterior]);
    const p = pombo(pid); if (p) p['foto_' + tipo] = caminho;
    state.fotoUrls.set(caminho, { url: URL.createObjectURL(blob), ate: Date.now() + 50 * 60 * 1000 });
    state.fotoEnviando = null;
    await carregarFicha(pid);
    toast('Foto salva.');
  } catch (err) {
    if (caminho) sb.storage.from('fotos').remove([caminho]);
    state.fotoEnviando = null;
    toast(erroFoto(err.message || err));
  }
  render();
}

async function removerFoto(btn) {
  const tipo = btn.dataset.fotoRemover, pid = btn.dataset.pombo;
  if (!confirm(`Remover a foto ${tipo === 'olho' ? 'do olho' : 'da cabeça'}?`)) return;
  btn.disabled = true;
  const { data: anterior, error } = await sb.rpc('definir_foto', { p_pombo: pid, p_tipo: tipo, p_caminho: null });
  if (error) { btn.disabled = false; toast(erroFoto(error.message)); return; }
  if (anterior) sb.storage.from('fotos').remove([anterior]);
  const p = pombo(pid); if (p) p['foto_' + tipo] = null;
  await carregarFicha(pid);
  render();
  toast('Foto removida.');
}

function vFicha(id) {
  const p = pombo(id);
  const f = state.ficha;
  if (!state.dados.carregado) return shell('pombo', 'Pombo', '', erroDados() || carregandoHtml, { voltar: '#/plantel' });
  if (!p) return shell('pombo', 'Pombo', '', `<div class="vazio"><h2>Pombo não encontrado</h2><p>Ele não está no seu plantel nem entre os ancestrais dos seus pombos.</p><a class="btn btn-ghost" href="#/plantel">Voltar ao plantel</a></div>`, { voltar: '#/plantel' });
  const r = meuRegistro(id);
  const ano = p.nascimento ? dataBR(p.nascimento) : String(p.ano);
  const acoes = r
    ? `<a class="btn btn-primary" href="#/evento/${p.id}">${I.plus}Registrar no histórico</a><a class="btn btn-ghost" href="#/editar/${r.id}">${I.edit}Editar</a><a class="btn btn-ghost" href="#/pedigree/${p.id}">${I.tree}Pedigree em PDF</a>`
    : `<a class="btn btn-primary" href="#/novo?anilha=${encodeURIComponent(anilha(p))}&situacao=referencia">${I.plus}Adicionar ao meu plantel</a><a class="btn btn-ghost" href="#/pedigree/${p.id}">${I.tree}Pedigree em PDF</a>`;
  const pronto = f.id === id && !f.carregando;
  const donos = pronto ? f.donos : [];
  const filhos = pronto ? f.filhos : [];
  const corpo = `
    <div class="hero ${sexoCls(p.sexo)}">
      <span class="ring">${esc(anilha(p))}</span>
      <span class="name">${esc(p.nome || 'Sem nome')}</span>
      <div class="tags"><span class="tag">${sym(p.sexo)} ${sexoTxt(p.sexo)}</span>${p.cor ? `<span class="tag">${esc(p.cor)}</span>` : ''}<span class="tag">${p.nascimento ? 'Nasceu em ' + ano : 'Ano ' + ano}</span>${r ? `<span class="tag ${r.situacao === 'ativo' ? 'ok' : ''}">${SIT[r.situacao]}</span>` : '<span class="tag">Não está no seu plantel</span>'}</div>
    </div>
    <div class="actions">${acoes}</div>
    ${!r ? '<p class="hint">Este pombo aparece aqui porque é ancestral de um pombo seu.</p>' : ''}
    <div class="ficha-grid">
    <div class="col">
    <section class="section"><h2>Pais</h2><div class="parents">${pcard(p.pai_id, 'Pai', 'M')}${pcard(p.mae_id, 'Mãe', 'F')}</div></section>
    ${fotosHtml(p, r, pronto)}
    ${r && r.observacoes ? `<section class="section"><h2>Minhas observações</h2><p class="obs">${esc(r.observacoes)}</p><p class="hint">Só você vê estas observações.</p></section>` : ''}
    <section class="section"><h2>Pombais por onde passou</h2>
      ${!pronto ? carregandoHtml : donos.length ? `<ul class="donos">${donos.map(d => `<li class="${d.voce ? 'voce' : ''}">
        <b>${esc(d.nome_pombal)}${d.voce ? ' (você)' : ''}</b>
        <span>${esc([d.nome, d.cidade].filter(Boolean).join(' · '))}</span>
        <span class="tag ${d.situacao === 'ativo' ? 'ok' : ''}">${d.situacao === 'ativo' ? 'Está com ele' : SIT[d.situacao]}</span>
        ${d.data_entrada || d.data_saida ? `<small>${d.data_entrada ? 'Desde ' + dataBR(d.data_entrada) : ''}${d.data_saida ? (d.data_entrada ? ' até ' : 'Até ') + dataBR(d.data_saida) : ''}</small>` : ''}
      </li>`).join('')}</ul>` : '<p class="hint">Nenhum pombal tem este pombo no plantel.</p>'}
    </section>
    <section class="section"><h2>Filhos (${filhos.length})</h2>
      ${!pronto ? carregandoHtml : filhos.length ? `<ul class="list">${filhos.map(c => {
        const conteudo = `<span class="sexbar"></span><span class="body"><span class="ring">${esc(c.anilha)}</span><span class="name">${esc(c.nome || 'Sem nome')}${c.cor ? ` · <span class="cor">${esc(c.cor)}</span>` : ''}</span><span class="meta">${c.pombais ? esc(c.pombais) : 'Sem pombal ativo'}</span></span><span class="side"><span class="sexsym ${sexoCls(c.sexo)}">${sym(c.sexo)}</span></span>`;
        return `<li>${c.visivel ? `<a class="bird ${sexoCls(c.sexo)}" href="#/pombo/${c.id}">${conteudo}</a>` : `<div class="bird ${sexoCls(c.sexo)}">${conteudo}</div>`}</li>`;
      }).join('')}</ul>` : '<p class="hint">Nenhum filho cadastrado no app.</p>'}
    </section>
    </div>
    <section class="section col"><h2>Histórico</h2>
      <p class="hint">O histórico é compartilhado: todos os pombais que têm ou tiveram este pombo veem os mesmos registros.</p>
      ${f.erro && f.id === id ? `<p class="msg erro">${esc(f.erro)}</p>` : !pronto ? carregandoHtml : historicoHtml(p)}
    </section>
    </div>`;
  return shell('pombo', p.nome || anilha(p), `${sexoTxt(p.sexo)}${p.cor ? ' · ' + p.cor : ''}`, corpo, { voltar: '#/plantel' });
}

// ----- Cadastro / edição -----
function podeEditarDados(r) {
  if (!r) return true;
  if (r.situacao === 'ativo') return true;
  const f = state.ficha;
  return !(f.donos || []).some(d => d.situacao === 'ativo' && !d.voce);
}

function vFormPombo(r, q) {
  const editando = !!r;
  const id = r ? r.pombo_id : null;
  if (editando && !(state.ficha.id === id && !state.ficha.carregando)) return shell('editar', 'Editar pombo', '', carregandoHtml, { voltar: `#/pombo/${id}` });
  const p = editando ? pombo(id) || {} : {};
  const pre = !editando && q.get('anilha') ? lerAnilha(q.get('anilha')) : null;
  const ring = editando ? { numero: p.numero, ano: String(p.ano % 100).padStart(2, '0'), pais: p.pais } : (pre && !pre.erro ? { numero: pre.numero, ano: pre.ano.slice(-2), pais: pre.pais } : { numero: '', ano: String(new Date().getFullYear() % 100).padStart(2, '0'), pais: 'BRA' });
  const sit = editando ? r.situacao : (q.get('situacao') || 'ativo');
  const pode = podeEditarDados(r);
  const travar = v => (!pode && v) ? 'disabled' : '';
  const sexo = editando ? p.sexo || '' : (q.get('sexo') || '');
  const pai = pombo(p.pai_id), mae = pombo(p.mae_id);
  const opcoesAnilha = s => state.dados.plantel.map(x => pombo(x.pombo_id)).filter(x => x && x.sexo === s && x.id !== id).map(x => `<option value="${esc(anilha(x))}">${esc(x.nome || '')}</option>`).join('');
  const dono = (state.ficha.donos || []).find(d => d.situacao === 'ativo' && !d.voce);
  const corpo = `<form id="f-pombo" class="form-grid" novalidate>
    ${editando ? `<input type="hidden" id="f-plantel" value="${esc(r.id)}">` : ''}
    <p class="msg erro full" id="f-erro" role="alert" hidden></p>
    <div class="full field-group">
      <span class="label">Anilha</span>
      <div class="row-3">
        <div class="field"><label for="f-num">Número</label><input class="input mono" id="f-num" placeholder="1402317" value="${esc(ring.numero)}" required autocomplete="off"></div>
        <div class="field"><label for="f-ano">Ano</label><input class="input mono" id="f-ano" inputmode="numeric" maxlength="4" placeholder="25" value="${esc(ring.ano)}" required></div>
        <div class="field"><label for="f-pais">País</label><input class="input mono" id="f-pais" list="paises" maxlength="4" value="${esc(ring.pais)}" required autocapitalize="characters"><datalist id="paises">${PAISES.map(x => `<option value="${x}">`).join('')}</datalist></div>
      </div>
      <p class="hint" id="ring-preview">Fica assim no pedigree: <b class="mono">${esc(`${ring.numero || '0000000'}/${ring.ano || '00'} ${ring.pais}`)}</b></p>
      <div id="ring-aviso"></div>
      ${editando ? '<p class="hint">Corrigir a anilha leva para o pombo certo os registros que você fez no histórico.</p>' : ''}
    </div>
    ${!pode ? `<p class="msg info full">Este pombo está no pombal <b>${esc(dono ? dono.nome_pombal : 'de outro criador')}</b>. Só quem está com ele pode mudar nome, sexo, cor, nascimento e pais. O que estiver em branco você pode completar.</p>` : ''}
    <div class="field"><label for="f-nome">Nome (opcional)</label><input class="input" id="f-nome" placeholder="Ex.: Trovão Azul" value="${esc(p.nome)}" ${travar(p.nome)}></div>
    <div class="field"><span class="label">Sexo</span><input type="hidden" id="f-sexo" value="${esc(sexo)}">
      <div class="seg"><button type="button" class="m" data-sexo="M" aria-pressed="${sexo === 'M'}" ${travar(p.sexo)}>♂ Macho</button><button type="button" class="f" data-sexo="F" aria-pressed="${sexo === 'F'}" ${travar(p.sexo)}>♀ Fêmea</button></div></div>
    <div class="field"><label for="f-cor">Cor</label><input class="input" id="f-cor" list="cores" placeholder="Ex.: Azul barrado" value="${esc(p.cor)}" ${travar(p.cor)}><datalist id="cores">${CORES.map(c => `<option value="${c}">`).join('')}</datalist></div>
    <div class="field"><label for="f-nasc">Data de nascimento (opcional)</label><input class="input" id="f-nasc" type="date" value="${esc(p.nascimento)}" ${travar(p.nascimento)}></div>
    <div class="field"><label for="f-pai">Anilha do pai</label><input class="input mono" id="f-pai" list="machos" placeholder="Ex.: 0812-334/19 ALE" value="${esc(anilha(pai))}" ${travar(pai)} autocomplete="off"><datalist id="machos">${opcoesAnilha('M')}</datalist></div>
    <div class="field"><label for="f-mae">Anilha da mãe</label><input class="input mono" id="f-mae" list="femeas" placeholder="Ex.: 1185320/18 BEL" value="${esc(anilha(mae))}" ${travar(mae)} autocomplete="off"><datalist id="femeas">${opcoesAnilha('F')}</datalist></div>
    <p class="hint full">Escreva a anilha dos pais como no pedigree (número/ano país). Se eles ainda não estão no app, são criados automaticamente.</p>
    <div class="field"><label for="f-sit">Situação</label><select class="input" id="f-sit">${SIT_FORM.map(([v, l]) => `<option value="${v}" ${v === sit ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field" data-se="entrou"><label for="f-origem">Como chegou ao pombal</label><select class="input" id="f-origem">${ORIGEM.map(([v, l]) => `<option value="${v}" ${v === ((r && r.origem) || '') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field" data-se="entrou"><label for="f-origem-obs">De quem? (opcional)</label><input class="input" id="f-origem-obs" placeholder="Ex.: comprado de João, leilão do clube" value="${esc(r && r.origem_obs)}"></div>
    <div class="field" data-se="entrou"><label for="f-entrada">Data de entrada (opcional)</label><input class="input" id="f-entrada" type="date" value="${esc(r && r.data_entrada)}"></div>
    <div class="field" data-se="saiu"><label for="f-saida">Data de saída</label><input class="input" id="f-saida" type="date" value="${esc(r && r.data_saida)}"></div>
    <div class="field" data-se="saiu"><label for="f-saida-obs">Detalhes da saída (opcional)</label><input class="input" id="f-saida-obs" placeholder="Ex.: vendido para Pombal Santa Rita" value="${esc(r && r.saida_obs)}"></div>
    <div class="field full"><label for="f-obs">Títulos e observações</label><textarea class="input" id="f-obs" placeholder="Linhagem, origem, prêmios… Vai para o pedigree.">${esc(r && r.observacoes)}</textarea><p class="hint">Só você vê. Provas e resultados registre no histórico do pombo, que é compartilhado.</p></div>
    <button class="btn btn-primary btn-block full" type="submit">${editando ? 'Salvar alterações' : 'Cadastrar pombo'}</button>
  </form>
  ${editando ? `<details class="remover"><summary>Tirar este pombo do meu plantel</summary>
    <p class="hint">Se você vendeu, cedeu ou perdeu o pombo, não apague: mude a situação acima. Assim a passagem dele pelo seu pombal continua no histórico. Apague só se cadastrou por engano.</p>
    <label class="check"><input type="checkbox" id="rm-registros"> Apagar também os registros que eu fiz no histórico dele</label>
    <button class="btn btn-perigo" type="button" data-remover="${esc(r.id)}">Tirar do meu plantel</button>
  </details>` : ''}`;
  return shell(editando ? 'editar' : 'novo', editando ? 'Editar pombo' : 'Cadastrar pombo', editando ? anilha(p) : 'Novo pombo no plantel', corpo, { voltar: editando ? `#/pombo/${id}` : '#/plantel' });
}

function ajustarCamposSituacao() {
  const s = $('#f-sit'); if (!s) return;
  const v = s.value;
  document.querySelectorAll('[data-se="entrou"]').forEach(el => { el.hidden = v === 'referencia'; });
  document.querySelectorAll('[data-se="saiu"]').forEach(el => { el.hidden = !SAIU.includes(v); });
}

let buscaT;
function verificarAnilha() {
  const prev = $('#ring-preview b'); if (!prev) return;
  const n = $('#f-num').value.trim(), a = $('#f-ano').value.trim(), pa = $('#f-pais').value.trim().toUpperCase();
  prev.textContent = `${n || '0000000'}/${(a || '00').slice(-2)} ${pa}`;
  const aviso = $('#ring-aviso');
  aviso.innerHTML = '';
  clearTimeout(buscaT);
  if (!n || !/^\d{2}(\d{2})?$/.test(a) || !/^[A-Z]{2,4}$/.test(pa)) return;
  buscaT = setTimeout(async () => {
    const { data, error } = await sb.rpc('buscar_anilha', { p_pais: pa, p_ano: Number(a), p_numero: n });
    if (error || !data || !data.existe || !$('#ring-aviso')) return;
    const atual = $('#f-plantel') && meuRegistro(data.pombo_id);
    if (atual && $('#f-plantel').value === atual.id) return;
    $('#ring-aviso').innerHTML = data.no_meu_plantel
      ? `<p class="msg erro">Esta anilha já está no seu plantel. <a href="#/pombo/${esc(data.pombo_id)}">Abrir a ficha</a></p>`
      : `<p class="msg info"><b>Este pombo já está no app.</b> Passou por ${data.pombais} ${data.pombais === 1 ? 'pombal' : 'pombais'} e tem ${data.registros} ${data.registros === 1 ? 'registro' : 'registros'} no histórico. Ao salvar, ele entra no seu plantel e você passa a ver o histórico completo. Nome, cor e pais já cadastrados são mantidos; você completa o que estiver em branco.</p>`;
  }, 350);
}

// ----- Registro no histórico -----
function vFormEvento(pomboId, eventoId) {
  const p = pombo(pomboId);
  const f = state.ficha;
  if (!state.dados.carregado || (eventoId && !(f.id === pomboId && !f.carregando))) return shell('evento', 'Histórico', '', erroDados() || carregandoHtml, { voltar: `#/pombo/${pomboId}` });
  if (!p || !meuRegistro(pomboId)) return shell('evento', 'Histórico', '', '<p class="msg erro">Só dá para registrar no histórico de pombos que estão no seu plantel.</p>', { voltar: `#/pombo/${pomboId}` });
  const e = eventoId ? f.eventos.find(x => x.id === eventoId) : null;
  if (eventoId && !e) return shell('evento', 'Histórico', '', '<p class="msg erro">Registro não encontrado.</p>', { voltar: `#/pombo/${pomboId}` });
  const tipo = e ? e.tipo : 'prova';
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const corpo = `<form id="f-evento" class="form-grid" novalidate>
    <input type="hidden" id="e-pombo" value="${esc(pomboId)}">${e ? `<input type="hidden" id="e-id" value="${esc(e.id)}">` : ''}
    <p class="msg erro full" id="e-erro" role="alert" hidden></p>
    <div class="field"><label for="e-tipo">Tipo</label><select class="input" id="e-tipo">${TIPOS_MANUAIS.map(t => `<option value="${t}" ${t === tipo ? 'selected' : ''}>${TIPOS[t]}</option>`).join('')}</select></div>
    <div class="field"><label for="e-data">Data</label><input class="input" id="e-data" type="date" value="${esc(e ? e.data : hoje)}"></div>
    <div class="field full" data-tipo="prova"><label for="e-prova">Prova / local de soltura</label><input class="input" id="e-prova" placeholder="Ex.: Campeonato Estadual · Soltura em Uberlândia" value="${esc(e && e.prova_nome)}"></div>
    <div class="field" data-tipo="prova"><label for="e-col">Colocação</label><input class="input" id="e-col" type="number" min="1" inputmode="numeric" placeholder="Ex.: 1" value="${esc(e && e.colocacao)}"></div>
    <div class="field" data-tipo="prova"><label for="e-part">Total de pombos na prova</label><input class="input" id="e-part" type="number" min="1" inputmode="numeric" placeholder="Ex.: 1840" value="${esc(e && e.participantes)}"></div>
    <div class="field" data-tipo="prova"><label for="e-dist">Distância (km)</label><input class="input" id="e-dist" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Ex.: 320" value="${esc(e && e.distancia_km)}"></div>
    <div class="field" data-tipo="prova"><label for="e-vel">Velocidade (m/min)</label><input class="input" id="e-vel" type="number" min="0" step="0.001" inputmode="decimal" placeholder="Ex.: 1245.5" value="${esc(e && e.velocidade)}"></div>
    <div class="field full"><label for="e-desc">Detalhes</label><textarea class="input" id="e-desc" placeholder="Ex.: vacina contra paramixovírus; acasalado com a 1185320/18 BEL; 1º ás pombo do clube…">${esc(e && e.descricao)}</textarea></div>
    <p class="hint full">Este registro fica visível para todos os pombais que tiverem este pombo, com o nome do seu pombal. Só você pode alterar ou apagar o que registrou.</p>
    <button class="btn btn-primary btn-block full" type="submit">${e ? 'Salvar alterações' : 'Registrar'}</button>
    ${e ? `<button class="btn btn-perigo btn-block full" type="button" data-apagar-evento="${esc(e.id)}">Apagar este registro</button>` : ''}
  </form>`;
  return shell('evento', e ? 'Editar registro' : 'Registrar no histórico', `${anilha(p)}${p.nome ? ' · ' + p.nome : ''}`, corpo, { voltar: `#/pombo/${pomboId}` });
}

function ajustarCamposTipo() {
  const s = $('#e-tipo'); if (!s) return;
  document.querySelectorAll('[data-tipo="prova"]').forEach(el => { el.hidden = s.value !== 'prova'; });
}

// ----- Pedigree -----
// Árvore em posições: 1 = pombo, 2 = pai, 3 = mãe, 4 = pai do pai… (filhos de n: 2n e 2n+1).
function arvore(id, geracoes = 5) {
  const pos = new Array(2 ** geracoes).fill(null);
  pos[1] = pombo(id);
  for (let n = 1; n < 2 ** (geracoes - 1); n++) {
    const p = pos[n];
    if (!p) continue;
    pos[2 * n] = pombo(p.pai_id);
    pos[2 * n + 1] = pombo(p.mae_id);
  }
  return pos;
}

const NOMES_GERACAO = ['', 'Pais', 'Avós', 'Bisavós', 'Trisavós'];
function rotuloPos(n) {
  const g = Math.floor(Math.log2(n)), macho = n % 2 === 0;
  if (g === 1) return macho ? 'Pai' : 'Mãe';
  const lado = n < 3 * 2 ** (g - 1) ? 'paterno' : 'materno';
  const base = { 2: macho ? 'Avô' : 'Avó', 3: macho ? 'Bisavô' : 'Bisavó', 4: macho ? 'Trisavô' : 'Trisavó' }[g];
  return `${base} ${macho ? lado : lado.replace(/o$/, 'a')}`;
}

function vPedigreeEscolher() {
  if (!state.dados.carregado) return shell('pedigree', 'Pedigree', nomePombal(), erroDados() || carregandoHtml);
  if (!state.dados.plantel.length) {
    return shell('pedigree', 'Pedigree', nomePombal(), `${erroDados()}<div class="vazio">${I.tree}<h2>Nenhum pombo ainda</h2>
      <p>Cadastre um pombo com pai e mãe para emitir o pedigree dele.</p><a class="btn btn-primary" href="#/novo">${I.plus}Cadastrar pombo</a></div>`);
  }
  return shell('pedigree', 'Pedigree', 'Escolha o pombo', `${erroDados()}
    <p class="hint">O pedigree sai em PDF (folha A4) com 5 gerações: o pombo, pais, avós, bisavós e trisavós. No cabeçalho vão os dados de <a href="#/conta">Meu pombal</a>.</p>
    <div class="search">${I.search}<input class="input" id="q-ped" type="search" placeholder="Buscar por anilha, nome ou cor" value="${esc(state.q)}" aria-label="Buscar"></div>
    <ul class="list" id="lista-ped">${listaPedigreeHtml()}</ul>`);
}

function listaPedigreeHtml() {
  const q = state.q.trim().toLowerCase();
  const l = state.dados.plantel.map(r => ({ r, p: pombo(r.pombo_id) }))
    .filter(({ p }) => p && (!q || [anilha(p), p.numero, p.nome, p.cor].some(v => v && String(v).toLowerCase().includes(q))))
    .sort((x, y) => ((y.r.situacao === 'ativo') - (x.r.situacao === 'ativo')) || (y.p.ano - x.p.ano) || x.p.numero.localeCompare(y.p.numero, 'pt-BR', { numeric: true }));
  return l.length ? l.map(({ r, p }) => itemPombo(p, r, `#/pedigree/${p.id}`)).join('') : '<li class="empty">Nenhum pombo encontrado.</li>';
}

function pcardPed(p, n) {
  const f = n % 2 === 1 ? 'f' : '';
  if (!p) return `<div class="pcard unknown ${f}"><small>${rotuloPos(n)}</small><span>Não informado</span></div>`;
  return `<a class="pcard ${f}" href="#/pombo/${p.id}"><small>${rotuloPos(n)}</small><span class="mono">${esc(anilha(p))}</span><span>${esc(p.nome || p.cor || '')}</span></a>`;
}

function vPedigree(id) {
  if (!id) return vPedigreeEscolher();
  if (!state.dados.carregado) return shell('pedigree', 'Pedigree', '', erroDados() || carregandoHtml, { voltar: '#/pedigree' });
  const p = pombo(id);
  if (!p) return shell('pedigree', 'Pedigree', '', '<div class="vazio"><h2>Pombo não encontrado</h2><a class="btn btn-ghost" href="#/pedigree">Escolher outro pombo</a></div>', { voltar: '#/pedigree' });
  const pos = arvore(id);
  const faltam = pos.slice(2).filter(x => !x).length;
  const r = meuRegistro(id);
  const perfil = state.perfil || {};
  const semCabecalho = !perfil.nome_pombal && !perfil.nome;
  let geracoes = '';
  for (let g = 1; g <= 4; g++) {
    const cards = [];
    for (let n = 2 ** g; n < 2 ** (g + 1); n++) cards.push(pcardPed(pos[n], n));
    geracoes += `<section class="section"><h2>${NOMES_GERACAO[g]}</h2><div class="ped-ger g${g}">${cards.join('')}</div></section>`;
  }
  const corpo = `
    <div class="hero ${sexoCls(p.sexo)}">
      <span class="ring">${esc(anilha(p))}</span>
      <span class="name">${esc(p.nome || 'Sem nome')}</span>
      <div class="tags"><span class="tag">${sym(p.sexo)} ${sexoTxt(p.sexo)}</span>${p.cor ? `<span class="tag">${esc(p.cor)}</span>` : ''}<span class="tag">${30 - faltam} de 30 ancestrais cadastrados</span></div>
    </div>
    ${semCabecalho ? `<p class="msg info">Preencha os dados de <a href="#/conta">Meu pombal</a> (nome do pombal, cidade, telefone) para eles saírem no cabeçalho do pedigree.</p>` : ''}
    <div class="field"><label for="ped-texto">Texto no quadro do pombo</label>
      <textarea class="input" id="ped-texto" placeholder="Ex.: Pombo cedido a Fulano · Linhagem, títulos e prêmios">${esc(r && r.observacoes)}</textarea>
      <p class="hint">Vem das observações do pombo. Pode mudar aqui só para este PDF. O texto de cada ancestral vem de "Títulos e observações" na ficha dele.</p></div>
    ${p.foto_olho || p.foto_cabeca ? `<label class="check"><input type="checkbox" id="ped-fotos" checked> Incluir no PDF as fotos ${p.foto_olho && p.foto_cabeca ? 'do olho e da cabeça' : p.foto_olho ? 'do olho' : 'da cabeça'}</label>` : ''}
    <div class="actions"><button class="btn btn-primary" type="button" data-pdf="${esc(p.id)}">${I.tree}Baixar pedigree em PDF</button><a class="btn btn-ghost" href="#/pedigree">Escolher outro pombo</a></div>
    ${faltam ? `<p class="hint">${faltam === 1 ? 'Falta 1 ancestral' : `Faltam ${faltam} ancestrais`}. Os quadros vazios saem em branco no PDF. Para completar, abra o ancestral e informe o pai e a mãe dele.</p>` : ''}
    ${geracoes}`;
  return shell('pedigree', 'Pedigree', anilha(p) + (p.nome ? ' · ' + p.nome : ''), corpo, { voltar: '#/pedigree' });
}

// ----- PDF do pedigree (gerado no navegador com jsPDF) -----
let jsPDFPromessa;
function carregarJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPDFPromessa) {
    jsPDFPromessa = new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'vendor/jspdf.umd.min.js';
      s.onload = () => ok(window.jspdf.jsPDF);
      s.onerror = () => { jsPDFPromessa = null; falha(new Error('Não foi possível carregar o gerador de PDF. Verifique sua internet e tente de novo.')); };
      document.head.appendChild(s);
    });
  }
  return jsPDFPromessa;
}

// As fontes padrão do PDF só têm letras latinas: troca o resto por equivalentes simples.
const textoPdf = s => String(s ?? '').normalize('NFC')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/…/g, '...').replace(/→/g, '->').replace(/♂/g, 'M').replace(/♀/g, 'F')
  .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '');

async function imagensParaPdf(caminhos) {
  await carregarUrlsFotos(caminhos);
  return Promise.all(caminhos.map(async c => {
    const url = urlFoto(c);
    if (!url) return null;
    try {
      const blob = await (await fetch(url)).blob();
      const dados = await new Promise((ok, falha) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = falha; fr.readAsDataURL(blob); });
      const img = await abrirImagem(dados);
      return { dados, w: img.naturalWidth, h: img.naturalHeight };
    } catch (e) { return null; }
  }));
}

async function gerarPedigreePDF(id, textoPrincipal, incluirFotos) {
  const JsPDF = await carregarJsPDF();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pos = arvore(id);
  const alvo = pos[1];
  const perfil = state.perfil || {};
  const PT = 0.3528; // 1 ponto em mm
  const W = 210, M = 10;

  // Cabeçalho: dados do pombal
  const titulo = [perfil.nome, perfil.nome_pombal].map(x => (x || '').trim()).filter(Boolean)
    .filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(' - ');
  const linhasCab = [
    [titulo || 'Pedigree', 13],
    [(perfil.cidade || '').toUpperCase(), 9],
    [perfil.email_contato, 9],
    [perfil.telefone ? 'Tel. ' + perfil.telefone : '', 9]
  ].filter(([t]) => t && String(t).trim());
  let y = 13;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  linhasCab.forEach(([t, tam], i) => {
    doc.setFontSize(tam);
    doc.text(textoPdf(t), W / 2, y, { align: 'center', maxWidth: W - 2 * M });
    y += tam * PT * 1.25 + (i === 0 ? 0.6 : 0);
  });

  // Árvore
  const topo = Math.max(y + 3, 36), base = 281, H = base - topo;
  const colunas = [ // x, largura, altura do quadro, tamanho da anilha, tamanho do texto
    { x: 10, w: 32, h: 72, fa: 10, ft: 8 },
    { x: 46, w: 37, h: H / 2 * 0.72, fa: 9, ft: 7.5 },
    { x: 87, w: 38, h: H / 4 * 0.92, fa: 8.5, ft: 7 },
    { x: 129, w: 37, h: H / 8 * 0.9, fa: 8, ft: 6.5 },
    { x: 170, w: 30, h: H / 16 * 0.86, fa: 7, ft: 6 }
  ];
  const CORES_PDF = { M: [226, 247, 250], F: [252, 228, 246], X: [255, 255, 255] };
  const centro = n => { const g = Math.floor(Math.log2(n)); const slot = H / 2 ** g; return topo + (n - 2 ** g + 0.5) * slot; };
  const caixa = n => { const g = Math.floor(Math.log2(n)); const c = colunas[g]; const cy = centro(n); return { g, c, x: c.x, y: cy - c.h / 2, w: c.w, h: c.h, cy }; };

  // Linhas de ligação
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.2);
  for (let n = 1; n < 16; n++) {
    const b = caixa(n), f1 = caixa(2 * n), f2 = caixa(2 * n + 1);
    const xm = (b.x + b.w + f1.x) / 2;
    doc.line(b.x + b.w, b.cy, xm, b.cy);
    doc.line(xm, f1.cy, xm, f2.cy);
    doc.line(xm, f1.cy, f1.x, f1.cy);
    doc.line(xm, f2.cy, f2.x, f2.cy);
  }

  // Quadros
  for (let n = 1; n < 32; n++) {
    const b = caixa(n), p = pos[n];
    const cor = n === 1 ? CORES_PDF.X : n % 2 === 0 ? CORES_PDF.M : CORES_PDF.F;
    doc.setFillColor(...cor);
    doc.setDrawColor(70, 70, 70);
    doc.setLineWidth(0.25);
    doc.rect(b.x, b.y, b.w, b.h, 'FD');
    if (!p) continue;
    const pad = 1.4, larg = b.w - 2 * pad, limite = b.y + b.h - pad;
    let ty = b.y + pad + b.c.fa * PT * 0.85;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(b.c.fa);
    doc.text(textoPdf(anilha(p)), b.x + pad, ty, { maxWidth: larg });
    ty += b.c.fa * PT * 0.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(b.c.ft);
    const lh = b.c.ft * PT * 1.18;
    const sexoCor = [p.sexo ? sexoTxt(p.sexo) : '', p.cor].filter(Boolean).join(' · ');
    const reg = meuRegistro(p.id);
    const obs = n === 1 ? textoPrincipal : reg && reg.observacoes;
    const partes = [];
    if (p.nome) partes.push('"' + p.nome + '"');
    if (sexoCor) partes.push(sexoCor);
    if (n === 1 && p.nascimento) partes.push('Nascimento: ' + dataBR(p.nascimento));
    if (obs) String(obs).split(/\r?\n/).forEach(l => partes.push(l));
    let linhas = [];
    partes.forEach(t => { linhas = linhas.concat(doc.splitTextToSize(textoPdf(t), larg)); });
    const cabem = Math.max(0, Math.floor((limite - ty) / lh));
    if (linhas.length > cabem) {
      linhas = linhas.slice(0, cabem);
      if (cabem) {
        let ult = linhas[cabem - 1].replace(/\s+$/, '');
        while (ult && doc.getTextWidth(ult + '...') > larg) ult = ult.slice(0, -1);
        linhas[cabem - 1] = ult + '...';
      }
    }
    linhas.forEach(l => { ty += lh; doc.text(l, b.x + pad, ty - lh * 0.25); });
  }

  // Fotos do olho e da cabeça na coluna do pombo (acima e abaixo do quadro)
  if (incluirFotos) {
    const b = caixa(1);
    const fotos = await imagensParaPdf([alvo.foto_olho, alvo.foto_cabeca]);
    const lugares = [
      { foto: fotos[0], rot: 'Olho', yMin: topo, yMax: b.y - 3, emCima: true },
      { foto: fotos[1], rot: 'Cabeça', yMin: b.y + b.h + 3, yMax: base, emCima: false }
    ];
    lugares.forEach(l => {
      if (!l.foto) return;
      const maxW = b.w, maxH = Math.min(44, l.yMax - l.yMin - 4);
      if (maxH < 10) return;
      const esc_ = Math.min(maxW / l.foto.w, maxH / l.foto.h);
      const w = l.foto.w * esc_, h = l.foto.h * esc_;
      const x = b.x + (b.w - w) / 2;
      const y = l.emCima ? l.yMax - h : l.yMin + 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(90, 90, 90);
      doc.text(textoPdf(l.rot), b.x, y - 1.2);
      doc.addImage(l.foto.dados, 'JPEG', x, y, w, h);
      doc.setDrawColor(70, 70, 70); doc.setLineWidth(0.25); doc.rect(x, y, w, h);
    });
    doc.setTextColor(0, 0, 0);
  }

  // Rodapé discreto
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);
  doc.text(textoPdf(`Gerado pelo app ${C.nomeApp} (desenvolvido por ${C.criador})`), M, 290);
  doc.text('Emitido em ' + new Date().toLocaleDateString('pt-BR'), W - M, 290, { align: 'right' });

  doc.setProperties({ title: textoPdf('Pedigree ' + anilha(alvo)), author: textoPdf(titulo), creator: textoPdf(`${C.nomeApp} (desenvolvido por ${C.criador})`) });
  const arquivo = 'pedigree-' + anilha(alvo).replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
  doc.save(arquivo);
}

function vConta() {
  const p = state.perfil || {};
  const erro = state.perfilErro ? `<p class="msg erro full" role="alert">${esc(state.perfilErro)}</p>` : '';
  const email = state.session && state.session.user.email;
  return shell('conta', 'Meu pombal', 'Conta e dados do pedigree', `
    <form id="f-perfil" class="form-grid">
      ${erro}
      <p class="hint full">Estes dados vão aparecer no cabeçalho dos pedigrees que você emitir. O nome do pombal, seu nome e a cidade também aparecem no histórico dos pombos que passarem por você (e-mail e telefone não).</p>
      <div class="field"><label for="p-nome">Seu nome</label><input class="input" id="p-nome" value="${esc(p.nome)}" autocomplete="name"></div>
      <div class="field"><label for="p-pombal">Nome do pombal</label><input class="input" id="p-pombal" value="${esc(p.nome_pombal)}"></div>
      <div class="field full"><label for="p-cidade">Cidade, estado e país</label><input class="input" id="p-cidade" value="${esc(p.cidade)}" placeholder="Ex.: Campinas - SP - Brasil"></div>
      <div class="field"><label for="p-email">E-mail de contato</label><input class="input" id="p-email" type="email" value="${esc(p.email_contato)}"></div>
      <div class="field"><label for="p-tel">Telefone / WhatsApp</label><input class="input" id="p-tel" type="tel" value="${esc(p.telefone)}"></div>
      <button class="btn btn-primary btn-block full" type="submit" ${state.ocupado ? 'disabled' : ''}>Salvar</button>
    </form>
    <div class="sessao"><p class="hint">Conectado como <b>${esc(email)}</b></p>
    <button class="btn btn-ghost" type="button" data-sair>Sair da conta</button></div>`);
}

// ---------- Render ----------
function render() {
  const app = $('#app');
  if (!state.pronto) { app.innerHTML = '<p class="carregando">Carregando…</p>'; return; }
  const logado = state.session && state.auth !== 'novaSenha';
  app.classList.toggle('sem-abas', !logado);
  if (!logado) { app.innerHTML = vAuth(); return; }
  const r = rota();
  let html;
  if (r.nome === 'conta') html = vConta();
  else if (r.nome === 'pedigree') html = vPedigree(r.a);
  else if (r.nome === 'pombo') html = vFicha(r.a);
  else if (r.nome === 'novo') html = state.dados.carregado ? vFormPombo(null, r.q) : shell('novo', 'Cadastrar pombo', '', erroDados() || carregandoHtml, { voltar: '#/plantel' });
  else if (r.nome === 'editar') {
    const reg = state.dados.plantel.find(x => x.id === r.a);
    html = !state.dados.carregado ? shell('editar', 'Editar pombo', '', erroDados() || carregandoHtml, { voltar: '#/plantel' })
      : reg ? vFormPombo(reg, r.q) : shell('editar', 'Editar pombo', '', '<p class="msg erro">Este pombo não está no seu plantel.</p>', { voltar: '#/plantel' });
  } else if (r.nome === 'evento') html = vFormEvento(r.a, r.b);
  else html = vPlantel();
  app.innerHTML = html;
  ajustarCamposSituacao();
  ajustarCamposTipo();
}

// ---------- Dados ----------
const faltaSQL = m => /relation|schema cache|does not exist|could not find the function/i.test(m || '');

async function carregarPerfil() {
  state.perfilErro = null;
  if (!state.session) { state.perfil = null; return; }
  const { data, error } = await sb.from('perfis').select('*').eq('id', state.session.user.id).maybeSingle();
  if (error) {
    state.perfil = null;
    state.perfilErro = faltaSQL(error.message)
      ? 'O banco de dados ainda não foi preparado (falta rodar o SQL no Supabase).'
      : traduzir(error.message);
    return;
  }
  state.perfil = data;
}

async function carregarPlantel() {
  if (!state.session) { state.dados = { carregado: false, erro: null, plantel: [], pombos: new Map() }; return; }
  const [pl, po] = await Promise.all([
    sb.from('plantel').select('*'),
    sb.from('pombos').select('*')
  ]);
  const err = pl.error || po.error;
  if (err) {
    state.dados = { carregado: false, plantel: [], pombos: new Map(),
      erro: faltaSQL(err.message) ? 'O banco de dados ainda não tem o plantel: falta rodar o arquivo 02_plantel_historico.sql no Supabase.' : traduzir(err.message) };
    return;
  }
  state.dados = { carregado: true, erro: null, plantel: pl.data || [], pombos: new Map((po.data || []).map(p => [p.id, p])) };
}

async function carregarFicha(id) {
  state.ficha = { id, carregando: true, erro: null, eventos: [], donos: [], filhos: [] };
  const [ev, dn, fl] = await Promise.all([
    sb.from('eventos').select('*').eq('pombo_id', id).order('data', { ascending: true, nullsFirst: false }).order('criado_em', { ascending: true }),
    sb.rpc('donos_do_pombo', { p: id }),
    sb.rpc('filhos_do_pombo', { p: id })
  ]);
  const p = pombo(id);
  if (p) await carregarUrlsFotos([p.foto_olho, p.foto_cabeca]);
  if (state.ficha.id !== id) return;
  const err = ev.error || dn.error || fl.error;
  state.ficha = { id, carregando: false, erro: err ? traduzir(err.message) : null, eventos: ev.data || [], donos: dn.data || [], filhos: fl.data || [] };
}

// Carrega o que a tela atual precisa e redesenha.
async function abrirRota() {
  const r = rota();
  if (!state.dados.carregado && !state.dados.erro) { await carregarPlantel(); }
  let pid = null;
  if (r.nome === 'pombo' || r.nome === 'evento') pid = r.a;
  if (r.nome === 'editar') { const reg = state.dados.plantel.find(x => x.id === r.a); pid = reg && reg.pombo_id; }
  if (pid && state.ficha.id !== pid) { state.ficha = { id: pid, carregando: true, erro: null, eventos: [], donos: [], filhos: [] }; render(); await carregarFicha(pid); }
  render();
}

async function recarregarTudo(pid) {
  await carregarPlantel();
  if (pid) await carregarFicha(pid);
}

// ---------- Eventos ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-foto-remover],[data-pdf],[data-auth],[data-sair],[data-filtro],[data-hist],[data-sexo],[data-remover],[data-apagar-evento]');
  if (!t) return;
  const d = t.dataset;
  if (d.fotoRemover) { removerFoto(t); return; }
  if (d.pdf) {
    const rotulo = t.innerHTML;
    t.disabled = true; t.textContent = 'Gerando PDF…';
    try { await gerarPedigreePDF(d.pdf, $('#ped-texto') ? $('#ped-texto').value.trim() : '', !!($('#ped-fotos') && $('#ped-fotos').checked)); toast('Pedigree gerado.'); }
    catch (err) { toast(err.message && /PDF/.test(err.message) ? err.message : 'Não foi possível gerar o PDF: ' + (err.message || err)); }
    t.disabled = false; t.innerHTML = rotulo;
    return;
  }
  if (d.auth) { state.auth = d.auth; state.authMsg = null; render(); return; }
  if (t.hasAttribute('data-sair')) { await sb.auth.signOut(); state.auth = 'entrar'; history.replaceState(null, '', location.pathname); return; }
  if (d.filtro) {
    state.filtro = d.filtro;
    document.querySelectorAll('[data-filtro]').forEach(c => c.setAttribute('aria-pressed', c.dataset.filtro === d.filtro));
    $('#lista').innerHTML = listaHtml();
    return;
  }
  if (d.hist) { state.histFiltro = d.hist; render(); return; }
  if (d.sexo) {
    $('#f-sexo').value = d.sexo;
    document.querySelectorAll('[data-sexo]').forEach(c => c.setAttribute('aria-pressed', c.dataset.sexo === d.sexo));
    return;
  }
  if (d.remover) {
    const apagar = $('#rm-registros') && $('#rm-registros').checked;
    if (!confirm(apagar ? 'Tirar este pombo do seu plantel e apagar os registros que você fez no histórico dele?' : 'Tirar este pombo do seu plantel?')) return;
    t.disabled = true;
    const { error } = await sb.rpc('remover_do_plantel', { p_plantel: d.remover, p_apagar_registros: !!apagar });
    if (error) { t.disabled = false; toast(traduzir(error.message)); return; }
    state.ficha = { id: null };
    await carregarPlantel();
    location.hash = '#/plantel';
    toast('Pombo retirado do plantel.');
    return;
  }
  if (d.apagarEvento) {
    if (!confirm('Apagar este registro do histórico?')) return;
    t.disabled = true;
    const pid = $('#e-pombo').value;
    const { error } = await sb.from('eventos').delete().eq('id', d.apagarEvento);
    if (error) { t.disabled = false; toast(traduzir(error.message)); return; }
    await carregarFicha(pid);
    location.hash = '#/pombo/' + pid;
    toast('Registro apagado.');
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') { state.q = e.target.value; $('#lista').innerHTML = listaHtml(); }
  if (e.target.id === 'q-ped') { state.q = e.target.value; $('#lista-ped').innerHTML = listaPedigreeHtml(); }
  if (['f-num', 'f-ano', 'f-pais'].includes(e.target.id)) verificarAnilha();
});

document.addEventListener('change', e => {
  if (e.target.matches('input[data-foto]')) enviarFoto(e.target);
  if (e.target.id === 'f-sit') ajustarCamposSituacao();
  if (e.target.id === 'e-tipo') ajustarCamposTipo();
});

async function ocupar(fn) {
  state.ocupado = true; render();
  try { await fn(); } catch (err) { state.authMsg = { tipo: 'erro', texto: traduzir(err.message || err) }; }
  state.ocupado = false; render();
}

function mostrarErro(sel, texto) {
  const el = $(sel);
  if (!el) { toast(texto); return; }
  el.textContent = texto; el.hidden = false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const CAMPOS = { nome: 'nome', sexo: 'sexo', cor: 'cor', nascimento: 'nascimento', pai: 'pai', mae: 'mãe' };

async function salvarPombo(form) {
  const v = sel => { const el = $(sel); return el ? el.value.trim() : ''; };
  const pai = lerAnilha(v('#f-pai')), mae = lerAnilha(v('#f-mae'));
  if (!v('#f-num') || !/^\d{2}(\d{2})?$/.test(v('#f-ano')) || !/^[A-Za-z]{2,4}$/.test(v('#f-pais'))) return mostrarErro('#f-erro', 'Preencha a anilha: número, ano (2 dígitos, ex.: 25) e país (ex.: BRA).');
  if (pai && pai.erro) return mostrarErro('#f-erro', 'Pai: ' + pai.erro);
  if (mae && mae.erro) return mostrarErro('#f-erro', 'Mãe: ' + mae.erro);
  const sit = v('#f-sit');
  const dados = {
    plantel_id: v('#f-plantel') || null,
    numero: v('#f-num'), ano: v('#f-ano'), pais: v('#f-pais').toUpperCase(),
    nome: v('#f-nome'), sexo: v('#f-sexo'), cor: v('#f-cor'), nascimento: v('#f-nasc'),
    pai, mae, situacao: sit,
    origem: sit === 'referencia' ? '' : v('#f-origem'),
    origem_obs: sit === 'referencia' ? '' : v('#f-origem-obs'),
    data_entrada: sit === 'referencia' ? '' : v('#f-entrada'),
    data_saida: SAIU.includes(sit) ? v('#f-saida') : '',
    saida_obs: SAIU.includes(sit) ? v('#f-saida-obs') : '',
    observacoes: $('#f-obs').value.trim()
  };
  const btn = form.querySelector('[type=submit]');
  const rotulo = btn.textContent;
  btn.disabled = true; btn.textContent = 'Salvando…';
  const { data, error } = await sb.rpc('salvar_pombo', { d: dados });
  if (error) {
    btn.disabled = false; btn.textContent = rotulo;
    return mostrarErro('#f-erro', faltaSQL(error.message) ? 'O banco de dados ainda não tem o plantel: falta rodar o arquivo 02_plantel_historico.sql no Supabase.' : traduzir(error.message));
  }
  await recarregarTudo(data.pombo_id);
  location.hash = '#/pombo/' + data.pombo_id;
  const ign = (data.ignorados || []).map(c => CAMPOS[c] || c);
  if (ign.length) toast(`Salvo. Não mudamos ${ign.join(', ')}: o pombo já tinha esses dados e só quem está com ele pode alterar.`);
  else toast(dados.plantel_id ? 'Alterações salvas.' : data.ja_existia ? 'Pombo cadastrado. O histórico dele já está disponível.' : 'Pombo cadastrado.');
}

async function salvarEvento(form) {
  const v = sel => { const el = $(sel); return el ? el.value.trim() : ''; };
  const n = sel => { const x = v(sel); return x === '' ? null : Number(x); };
  const tipo = v('#e-tipo'), prova = tipo === 'prova';
  const reg = {
    pombo_id: v('#e-pombo'), tipo, data: v('#e-data') || null, descricao: v('#e-desc') || null,
    prova_nome: prova ? v('#e-prova') || null : null,
    colocacao: prova ? n('#e-col') : null, participantes: prova ? n('#e-part') : null,
    distancia_km: prova ? n('#e-dist') : null, velocidade: prova ? n('#e-vel') : null
  };
  if (!reg.descricao && !reg.prova_nome && !reg.colocacao) return mostrarErro('#e-erro', 'Escreva algum detalhe do registro.');
  if (reg.colocacao && reg.participantes && reg.colocacao > reg.participantes) return mostrarErro('#e-erro', 'A colocação não pode ser maior que o total de pombos na prova.');
  const btn = form.querySelector('[type=submit]');
  const rotulo = btn.textContent;
  btn.disabled = true; btn.textContent = 'Salvando…';
  const id = v('#e-id');
  const { error } = id
    ? await sb.from('eventos').update(reg).eq('id', id)
    : await sb.from('eventos').insert(reg);
  if (error) { btn.disabled = false; btn.textContent = rotulo; return mostrarErro('#e-erro', traduzir(error.message)); }
  await carregarFicha(reg.pombo_id);
  location.hash = '#/pombo/' + reg.pombo_id;
  toast(id ? 'Registro alterado.' : 'Registrado no histórico.');
}

document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  const v = sel => { const el = $(sel); return el ? el.value.trim() : ''; };

  if (id === 'f-pombo') return salvarPombo(e.target);
  if (id === 'f-evento') return salvarEvento(e.target);
  if (id === 'f-auth') {
    const email = v('#a-email'), senha = $('#a-senha').value;
    if (state.auth === 'criar') {
      const nome = v('#a-nome'), nome_pombal = v('#a-pombal');
      return ocupar(async () => {
        const { data, error } = await sb.auth.signUp({
          email, password: senha,
          options: { data: { nome, nome_pombal }, emailRedirectTo: location.origin + location.pathname }
        });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          state.authMsg = { tipo: 'erro', texto: 'Já existe uma conta com este e-mail. Use "Entrar" ou "Esqueci minha senha".' };
        } else if (!data.session) {
          state.auth = 'entrar';
          state.authMsg = { tipo: 'ok', texto: 'Conta criada! Enviamos um e-mail para ' + email + '. Clique no link dele para ativar a conta e depois entre aqui.' };
        } else {
          state.authMsg = null;
          toast('Conta criada. Bem-vindo!');
        }
      });
    }
    return ocupar(async () => {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
      state.authMsg = null;
    });
  }

  if (id === 'f-esqueci') {
    const email = v('#a-email');
    return ocupar(async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
      state.authMsg = { tipo: 'ok', texto: 'Se existir uma conta com ' + email + ', você vai receber um e-mail com o link para criar nova senha.' };
    });
  }

  if (id === 'f-novasenha') {
    const senha = $('#a-senha').value;
    return ocupar(async () => {
      const { error } = await sb.auth.updateUser({ password: senha });
      if (error) throw error;
      state.auth = 'entrar'; state.authMsg = null;
      toast('Senha alterada!');
    });
  }

  if (id === 'f-perfil') {
    const dados = { id: state.session.user.id, nome: v('#p-nome'), nome_pombal: v('#p-pombal'), cidade: v('#p-cidade'), email_contato: v('#p-email'), telefone: v('#p-tel') };
    (async () => {
      state.ocupado = true; render();
      const { data, error } = await sb.from('perfis').upsert(dados).select().single();
      state.ocupado = false;
      if (error) { state.perfil = Object.assign({}, state.perfil, dados); state.perfilErro = traduzir(error.message); }
      else { state.perfil = data; state.perfilErro = null; toast('Dados salvos.'); }
      render();
    })();
  }
});


window.addEventListener('hashchange', () => { if (state.pronto && state.session) { render(); window.scrollTo(0, 0); abrirRota(); } else if (state.pronto) render(); });

sb.auth.onAuthStateChange((event, session) => {
  // Não chamar o Supabase direto aqui dentro (evita travar); agenda para depois.
  setTimeout(async () => {
    if (event === 'PASSWORD_RECOVERY') { state.auth = 'novaSenha'; state.authMsg = null; }
    const mudouUsuario = (state.session && state.session.user.id) !== (session && session.user.id);
    state.session = session;
    if (!state.pronto) return;
    if (mudouUsuario) {
      state.dados = { carregado: false, erro: null, plantel: [], pombos: new Map() };
      state.ficha = { id: null };
      await carregarPerfil();
      if (session) { render(); await abrirRota(); return; }
    }
    render();
  }, 0);
});

(async function iniciar() {
  try {
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    await carregarPerfil();
  } catch (err) {
    state.authMsg = { tipo: 'erro', texto: traduzir(err.message || err) };
  }
  state.pronto = true;
  if (state.session && /access_token|type=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/plantel');
  render();
  if (state.session) abrirRota();
})();
})();
