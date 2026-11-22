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
  fotoEnviando: null,     // 'olho' | 'cabeca' enquanto envia
  admin: false,           // a conta é de administrador (conferido no banco)
  vac: { carregado: false, faltaSQL: false, erro: null, vacinas: [], doses: new Map() }, // vacinas e última dose (vacina|pombo -> data)
  adm: { carregado: false, erro: null, resumo: null, usuarios: [], aba: 'usuarios', busca: '', pombos: null, plantel: {} }
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
  if (s.includes('password should be at least') || s.includes('weak_password') || s.includes('password is too weak')) return 'A senha é curta ou fraca demais. Use pelo menos 8 caracteres.';
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
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17" r=".6"/></svg>',
  whats: '<svg viewBox="0 0 24 24"><path d="M4 20l1.2-3.6A8 8 0 1 1 8 19z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9c-1-.4-2-1.4-2.4-2.4l.9-1-1-2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6l8.5 7 8.5-7"/></svg>',
  vacina: '<svg viewBox="0 0 24 24"><path d="M18 2l4 4M16 4l4 4M19 5l-9.5 9.5M14 6l4 4M6.5 13.5l4 4M9 11l-6 6v4h4l6-6"/><path d="M10.5 9.5l2 2M8 12l2 2"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
};

const linkWhats = () => C.whatsapp ? `https://wa.me/${encodeURIComponent(C.whatsapp)}?text=${encodeURIComponent('Olá! Preciso de ajuda com o app ' + C.nomeApp + '.')}` : '';
const contatosHtml = () => `<div class="contatos">
  ${C.whatsapp ? `<a class="btn btn-primary" href="${linkWhats()}" target="_blank" rel="noopener">${I.whats}WhatsApp ${esc(C.whatsappTexto || '')}</a>` : ''}
  ${C.emailContato ? `<a class="btn btn-ghost" href="mailto:${esc(C.emailContato)}?subject=${encodeURIComponent('Ajuda com o ' + C.nomeApp)}">${I.mail}${esc(C.emailContato)}</a>` : ''}
</div>`;

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
      <div class="field"><label for="a-senha">Nova senha</label><input class="input" id="a-senha" type="password" minlength="8" required autocomplete="new-password"></div>
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
      ${criar ? `<div class="field"><label for="a-nome">Seu nome</label><input class="input" id="a-nome" maxlength="100" required autocomplete="name"></div>
      <div class="field"><label for="a-pombal">Nome do pombal</label><input class="input" id="a-pombal" maxlength="100" placeholder="Ex.: Pombal Santa Rita"></div>` : ''}
      <div class="field"><label for="a-email">E-mail</label><input class="input" id="a-email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="a-senha">Senha</label><input class="input" id="a-senha" type="password" minlength="${criar ? 8 : 6}" required autocomplete="${criar ? 'new-password' : 'current-password'}"></div>
      <button class="btn btn-primary btn-block" type="submit" ${dis}>${state.ocupado ? 'Aguarde…' : criar ? 'Criar conta' : 'Entrar'}</button>
      ${criar ? '<p class="hint">A senha precisa ter pelo menos 8 caracteres. Seu plantel e os dados dos seus pombos (nome, cor, pais e fotos) são só seus; o histórico de provas de cada pombo é compartilhado com quem tiver a mesma anilha.</p>' : '<button type="button" class="link" data-auth="esqueci">Esqueci minha senha</button>'}
    </form>`;
  }
  return `<div class="wrap login view">
    <div class="brand"><img src="img/icone.svg" alt=""><h1>${esc(C.nomeApp)}</h1><p>Cadastre seu plantel e emita pedigrees com a árvore completa.</p></div>
    ${form}
    <details class="card ajuda-login"><summary>${I.help}Precisa de ajuda?</summary>
      <p class="hint">Fale com a gente pelo WhatsApp ou por e-mail.</p>${contatosHtml()}</details>
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
  const nomes = ['plantel', 'novo', 'pombo', 'editar', 'evento', 'pedigree', 'conta', 'admin', 'ajuda', 'vacinas', 'ler'];
  const nome = nomes.includes(partes[0]) ? partes[0] : 'plantel';
  return { nome, a: partes[1] || null, b: partes[2] || null, q: new URLSearchParams(busca) };
}

function shell(r, titulo, sub, corpo, { voltar = null, direita = '' } = {}) {
  const ativa = ['pombo', 'editar', 'evento'].includes(r) ? 'plantel' : r === 'ler' ? 'novo' : r;
  const aba = (n, ico, label) => `<a href="#/${n}" ${ativa === n ? 'aria-current="page"' : ''}>${ico}<span>${label}</span></a>`;
  const ajuda = r === 'ajuda' ? '' : `<a class="icon-btn so-celular" href="#/ajuda" aria-label="Ajuda">${I.help}</a>`;
  return `<header class="topbar wrap">${voltar ? `<a class="icon-btn" href="${voltar}" aria-label="Voltar">${I.back}</a>` : ''}
    <h1>${esc(titulo)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1>${ajuda}${direita}</header>
  <main class="view wrap"><div class="stack">${corpo}</div></main>
  <nav class="tabbar${state.admin ? ' com-admin' : ''}" aria-label="Menu">
    <a class="nav-brand" href="#/plantel"><img src="img/icone.svg" alt=""><span>${esc(C.nomeApp)}</span></a>
    ${aba('plantel', I.list, 'Plantel')}${aba('novo', `<span class="plus">${I.plus}</span>`, 'Cadastrar')}${aba('pedigree', I.tree, 'Pedigree')}${aba('conta', I.user, 'Meu pombal')}${state.admin ? aba('admin', I.shield, 'Admin') : ''}
    <a class="nav-extra" href="#/vacinas" ${ativa === 'vacinas' ? 'aria-current="page"' : ''}>${I.vacina}<span>Vacinas</span></a>
    <a class="nav-ajuda" href="#/ajuda" ${ativa === 'ajuda' ? 'aria-current="page"' : ''}>${I.help}<span>Ajuda</span></a>
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
    // Ancestrais ficam fora da lista do plantel; aparecem no filtro "Ancestrais" ou na busca.
    if (f === 'todos' && r.situacao === 'referencia' && !q) return false;
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
  if (l.length) return l.map(({ r, p }) => itemPombo(p, r)).join('');
  const temAncestral = state.dados.plantel.some(r => r.situacao === 'referencia');
  return state.filtro === 'todos' && !state.q.trim() && temAncestral
    ? '<li class="empty">Nenhum pombo no plantel ainda. Os ancestrais cadastrados para o pedigree estão no filtro "Ancestrais".</li>'
    : '<li class="empty">Nenhum pombo encontrado.</li>';
}

function vPlantel() {
  const novo = `<a class="icon-btn" href="#/novo" aria-label="Cadastrar pombo">${I.plus}</a>`;
  if (!state.dados.carregado) return shell('plantel', 'Plantel', nomePombal(), erroDados() || carregandoHtml, { direita: novo });
  const todos = state.dados.plantel;
  if (!todos.length) {
    return shell('plantel', 'Plantel', nomePombal(), `${erroDados()}
      <div class="vazio">${I.list}<h2>Nenhum pombo ainda</h2>
        <p>Cadastre seu primeiro pombo pela anilha. Se ele já passou por outro pombal que usa o app, o histórico dele aparece na hora.</p>
        <a class="btn btn-primary" href="#/novo">${I.plus}Cadastrar pombo</a>
        <a class="btn btn-ghost" href="#/ler">${I.camera}Ler pedigree por foto ou PDF</a></div>`, { direita: novo });
  }
  const ativos = todos.filter(r => r.situacao === 'ativo').map(r => pombo(r.pombo_id)).filter(Boolean);
  const noPlantel = todos.filter(r => r.situacao !== 'referencia').length;
  const ancestrais = todos.length - noPlantel;
  const chip = (v, l) => `<button type="button" class="chip" data-filtro="${v}" aria-pressed="${state.filtro === v}">${l}</button>`;
  return shell('plantel', 'Plantel', nomePombal(), `${erroDados()}
    <div class="stats"><a class="stats-link so-celular" href="#/vacinas">${I.vacina}Vacinas</a><a class="stats-link" href="#/ler">${I.camera}Ler pedigree</a><span><b>${ativos.length}</b> no pombal</span><span><b>${ativos.filter(p => p.sexo === 'M').length}</b> machos</span><span><b>${ativos.filter(p => p.sexo === 'F').length}</b> fêmeas</span><span><b>${noPlantel}</b> no plantel</span></div>
    ${avisoVacinasHtml()}
    <div class="search">${I.search}<input class="input" id="q" type="search" placeholder="Buscar por anilha, nome, cor ou pais" value="${esc(state.q)}" aria-label="Buscar"></div>
    <div class="chips">${chip('todos', 'Todos')}${chip('ativo', 'No pombal')}${chip('M', '♂ Machos')}${chip('F', '♀ Fêmeas')}${chip('referencia', `Ancestrais${ancestrais ? ` (${ancestrais})` : ''}`)}${chip('saiu', 'Saíram')}</div>
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
    ${pode ? '<p class="hint">Tire a foto com boa luz e de perto. O app diminui a foto antes de enviar. Só você vê as suas fotos.</p>' : ''}</section>`;
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
  if (/row-level security|unauthorized|403/i.test(s)) return 'Não foi possível salvar a foto. Confira se o pombo está no seu plantel (limite de 600 fotos por conta).';
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
    caminho = `${state.session.user.id}/${pid}/${tipo}-${Date.now()}.jpg`;
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
  const irm = pronto ? f.irmaos : { inteiros: [], pai: [], mae: [] };
  const totalIrmaos = irm.inteiros.length + irm.pai.length + irm.mae.length;
  const grupoIrmaos = (titulo, l) => l.length ? `<h3 class="subtit">${titulo} (${l.length})</h3>${listaParentes(l)}` : '';
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
    <section class="section"><h2>Irmãos${pronto && totalIrmaos ? ` (${totalIrmaos})` : ''}</h2>
      ${!p.pai_id && !p.mae_id ? '<p class="hint">Cadastre o pai e a mãe deste pombo para ver os irmãos dele.</p>'
        : !pronto ? carregandoHtml : totalIrmaos
          ? `${grupoIrmaos('Irmãos inteiros · mesmo pai e mesma mãe', irm.inteiros)}${grupoIrmaos('Meio-irmãos por parte de pai', irm.pai)}${grupoIrmaos('Meio-irmãos por parte de mãe', irm.mae)}`
          : '<p class="hint">Nenhum irmão cadastrado no app.</p>'}
      ${pronto && totalIrmaos && (!p.pai_id || !p.mae_id) ? `<p class="hint">Falta cadastrar ${!p.pai_id ? 'o pai' : 'a mãe'}: por isso ainda não dá para saber quem é irmão inteiro.</p>` : ''}
    </section>
    <section class="section"><h2>Filhos (${filhos.length})</h2>
      ${!pronto ? carregandoHtml : filhos.length ? listaParentes(filhos) : '<p class="hint">Nenhum filho cadastrado no app.</p>'}
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
// Os dados do pombo (nome, cor, pais, fotos) são de cada usuário: cada um muda os seus.
function podeEditarDados() { return true; }

function vFormPombo(r, q) {
  const editando = !!r;
  const volta = /^pedigree\/[0-9a-z-]+$/i.test(q.get('volta') || '') ? q.get('volta') : '';
  const lado = q.get('lado') === 'mae' ? 'mae' : 'pai';
  const filho = !editando && q.get('filho') ? pombo(q.get('filho')) : null;
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
  const corpo = `<form id="f-pombo" class="form-grid" novalidate>
    ${editando ? `<input type="hidden" id="f-plantel" value="${esc(r.id)}">` : ''}
    ${volta ? `<input type="hidden" id="f-volta" value="${esc(volta)}">` : ''}
    ${filho ? `<input type="hidden" id="f-filho" value="${esc(filho.id)}"><input type="hidden" id="f-lado" value="${lado}">
      <p class="msg info full">Você está cadastrando ${lado === 'pai' ? 'o <b>pai</b>' : 'a <b>mãe</b>'} de <b class="mono">${esc(anilha(filho))}</b>${filho.nome ? ' (' + esc(filho.nome) + ')' : ''}. Ao salvar, ${lado === 'pai' ? 'ele' : 'ela'} já fica ligad${lado === 'pai' ? 'o' : 'a'} no pedigree.</p>` : ''}
    ${!editando && !filho ? `<p class="msg info full">Tem o pedigree deste pombo? <a href="#/ler">Leia a foto ou o PDF com IA</a> e cadastre o pombo e os ancestrais de uma vez.</p>` : ''}
    <p class="msg erro full" id="f-erro" role="alert" hidden></p>
    <div class="full field-group">
      <span class="label">Anilha</span>
      <div class="row-3">
        <div class="field"><label for="f-num">Número</label><input class="input mono" id="f-num" maxlength="30" placeholder="1402317" value="${esc(ring.numero)}" required autocomplete="off"></div>
        <div class="field"><label for="f-ano">Ano</label><input class="input mono" id="f-ano" inputmode="numeric" maxlength="4" placeholder="25" value="${esc(ring.ano)}" required></div>
        <div class="field"><label for="f-pais">País</label><input class="input mono" id="f-pais" list="paises" maxlength="4" value="${esc(ring.pais)}" required autocapitalize="characters"><datalist id="paises">${PAISES.map(x => `<option value="${x}">`).join('')}</datalist></div>
      </div>
      <p class="hint" id="ring-preview">Fica assim no pedigree: <b class="mono">${esc(`${ring.numero || '0000000'}/${ring.ano || '00'} ${ring.pais}`)}</b></p>
      <div id="ring-aviso"></div>
      ${editando ? '<p class="hint">Corrigir a anilha leva para o pombo certo os registros que você fez no histórico.</p>' : ''}
    </div>
    <div class="field"><label for="f-nome">Nome (opcional)</label><input class="input" id="f-nome" maxlength="80" placeholder="Ex.: Trovão Azul" value="${esc(p.nome)}" ${travar(p.nome)}></div>
    <div class="field"><span class="label">Sexo</span><input type="hidden" id="f-sexo" value="${esc(sexo)}">
      <div class="seg"><button type="button" class="m" data-sexo="M" aria-pressed="${sexo === 'M'}" ${travar(p.sexo)}>♂ Macho</button><button type="button" class="f" data-sexo="F" aria-pressed="${sexo === 'F'}" ${travar(p.sexo)}>♀ Fêmea</button></div></div>
    <div class="field"><label for="f-cor">Cor</label><input class="input" id="f-cor" maxlength="60" list="cores" placeholder="Ex.: Azul barrado" value="${esc(p.cor)}" ${travar(p.cor)}><datalist id="cores">${CORES.map(c => `<option value="${c}">`).join('')}</datalist></div>
    <div class="field"><label for="f-nasc">Data de nascimento (opcional)</label><input class="input" id="f-nasc" type="date" value="${esc(p.nascimento)}" ${travar(p.nascimento)}></div>
    <div class="field"><label for="f-pai">Anilha do pai</label><input class="input mono" id="f-pai" list="machos" placeholder="Ex.: 0812-334/19 ALE" value="${esc(anilha(pai))}" ${travar(pai)} autocomplete="off"><datalist id="machos">${opcoesAnilha('M')}</datalist></div>
    <div class="field"><label for="f-mae">Anilha da mãe</label><input class="input mono" id="f-mae" list="femeas" placeholder="Ex.: 1185320/18 BEL" value="${esc(anilha(mae))}" ${travar(mae)} autocomplete="off"><datalist id="femeas">${opcoesAnilha('F')}</datalist></div>
    <p class="hint full">Escreva a anilha dos pais como no pedigree (número/ano país). Se eles ainda não estão no seu plantel, entram como ancestrais.</p>
    <div class="field"><label for="f-sit">Situação</label><select class="input" id="f-sit">${SIT_FORM.map(([v, l]) => `<option value="${v}" ${v === sit ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field" data-se="entrou"><label for="f-origem">Como chegou ao pombal</label><select class="input" id="f-origem">${ORIGEM.map(([v, l]) => `<option value="${v}" ${v === ((r && r.origem) || '') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field" data-se="entrou"><label for="f-origem-obs">De quem? (opcional)</label><input class="input" id="f-origem-obs" maxlength="300" placeholder="Ex.: comprado de João, leilão do clube" value="${esc(r && r.origem_obs)}"></div>
    <div class="field" data-se="entrou"><label for="f-entrada">Data de entrada (opcional)</label><input class="input" id="f-entrada" type="date" value="${esc(r && r.data_entrada)}"></div>
    <div class="field" data-se="saiu"><label for="f-saida">Data de saída</label><input class="input" id="f-saida" type="date" value="${esc(r && r.data_saida)}"></div>
    <div class="field" data-se="saiu"><label for="f-saida-obs">Detalhes da saída (opcional)</label><input class="input" id="f-saida-obs" maxlength="300" placeholder="Ex.: vendido para Pombal Santa Rita" value="${esc(r && r.saida_obs)}"></div>
    <div class="field full"><label for="f-obs">Títulos e observações</label><textarea class="input" id="f-obs" maxlength="4000" placeholder="Linhagem, origem, prêmios… Vai para o pedigree.">${esc(r && r.observacoes)}</textarea><p class="hint">Só você vê. Provas e resultados registre no histórico do pombo, que é compartilhado.</p></div>
    <button class="btn btn-primary btn-block full" type="submit">${editando ? 'Salvar alterações' : 'Cadastrar pombo'}</button>
  </form>
  ${editando ? `<details class="remover"><summary>Tirar este pombo do meu plantel</summary>
    <p class="hint">Se você vendeu, cedeu ou perdeu o pombo, não precisa tirar: mude a situação acima. Use esta opção só se cadastrou por engano.</p>
    <p class="hint">O histórico dele (provas, prêmios, entradas e saídas) fica guardado e continua aparecendo para todos. Depois de tirar, você não consegue mais alterar nem apagar os registros que fez.</p>
    <button class="btn btn-perigo" type="button" data-remover="${esc(r.id)}">Tirar do meu plantel</button>
  </details>` : ''}`;
  return shell(editando ? 'editar' : 'novo', editando ? 'Editar pombo' : filho ? 'Cadastrar ancestral' : 'Cadastrar pombo',
    editando ? anilha(p) : filho ? `${lado === 'pai' ? 'Pai' : 'Mãe'} de ${anilha(filho)}` : 'Novo pombo no plantel', corpo,
    { voltar: volta ? '#/' + volta : editando ? `#/pombo/${id}` : '#/plantel' });
}

function ajustarCamposSituacao() {
  const s = $('#f-sit'); if (!s) return;
  const v = s.value;
  document.querySelectorAll('[data-se="entrou"]').forEach(el => { el.hidden = v === 'referencia'; });
  document.querySelectorAll('[data-se="saiu"]').forEach(el => { el.hidden = !SAIU.includes(v); });
}

let buscaT, buscaAdmT;
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
      : `<div class="msg info"><p><b>Este pombo já está no app.</b> Passou por ${data.pombais} ${data.pombais === 1 ? 'pombal' : 'pombais'} e tem ${data.registros} ${data.registros === 1 ? 'registro' : 'registros'} no histórico. Ao salvar, ele entra no seu plantel e você passa a ver o histórico completo.</p>
        ${data.pode_copiar ? `<label class="check copiar"><input type="checkbox" id="f-copiar" checked> <span><b>Copiar os ancestrais</b> que outro criador cadastrou: nome, cor e nascimento do pombo, pais, avós, bisavós e trisavós. Vira uma cópia sua, que você pode mudar sem mexer no cadastro dele. O que você digitar aqui tem preferência. Fotos e dados do outro criador não são copiados.</span></label>` : ''}</div>`;
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
    <div class="field full" data-tipo="prova"><label for="e-prova">Prova / local de soltura</label><input class="input" id="e-prova" maxlength="200" placeholder="Ex.: Campeonato Estadual · Soltura em Uberlândia" value="${esc(e && e.prova_nome)}"></div>
    <div class="field" data-tipo="prova"><label for="e-col">Colocação</label><input class="input" id="e-col" type="number" min="1" inputmode="numeric" placeholder="Ex.: 1" value="${esc(e && e.colocacao)}"></div>
    <div class="field" data-tipo="prova"><label for="e-part">Total de pombos na prova</label><input class="input" id="e-part" type="number" min="1" inputmode="numeric" placeholder="Ex.: 1840" value="${esc(e && e.participantes)}"></div>
    <div class="field" data-tipo="prova"><label for="e-dist">Distância (km)</label><input class="input" id="e-dist" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Ex.: 320" value="${esc(e && e.distancia_km)}"></div>
    <div class="field" data-tipo="prova"><label for="e-vel">Velocidade (m/min)</label><input class="input" id="e-vel" type="number" min="0" step="0.001" inputmode="decimal" placeholder="Ex.: 1245.5" value="${esc(e && e.velocidade)}"></div>
    <div class="field full"><label for="e-desc">Detalhes</label><textarea class="input" id="e-desc" maxlength="2000" placeholder="Ex.: vacina contra paramixovírus; acasalado com a 1185320/18 BEL; 1º ás pombo do clube…">${esc(e && e.descricao)}</textarea></div>
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

function pcardPed(p, n, pos, raiz) {
  const f = n % 2 === 1 ? 'f' : '';
  const volta = encodeURIComponent('pedigree/' + raiz);
  if (!p) {
    const filho = pos[n >> 1];
    if (!filho) return `<div class="pcard unknown ${f}"><small>${rotuloPos(n)}</small><span>Não informado</span></div>`;
    const lado = n % 2 === 0 ? 'pai' : 'mae';
    return `<a class="pcard unknown novo ${f}" href="#/novo?situacao=referencia&sexo=${lado === 'pai' ? 'M' : 'F'}&filho=${filho.id}&lado=${lado}&volta=${volta}"><small>${rotuloPos(n)}</small><span>${I.plus}Cadastrar</span></a>`;
  }
  const reg = meuRegistro(p.id);
  const href = reg ? `#/editar/${reg.id}?volta=${volta}` : `#/pombo/${p.id}`;
  return `<a class="pcard ${f}" href="${href}" title="${reg ? 'Editar' : 'Abrir a ficha'}"><small>${rotuloPos(n)}</small><span class="mono">${esc(anilha(p))}</span><span>${esc(p.nome || p.cor || '')}</span></a>`;
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
    for (let n = 2 ** g; n < 2 ** (g + 1); n++) cards.push(pcardPed(pos[n], n, pos, id));
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
      <textarea class="input" id="ped-texto" maxlength="4000" placeholder="Ex.: Pombo cedido a Fulano · Linhagem, títulos e prêmios">${esc(r && r.observacoes)}</textarea>
      <p class="hint">Vem das observações do pombo. Pode mudar aqui só para este PDF. O texto de cada ancestral vem de "Títulos e observações" na ficha dele.</p></div>
    ${p.foto_olho || p.foto_cabeca ? `<label class="check"><input type="checkbox" id="ped-fotos" checked> Incluir no PDF as fotos ${p.foto_olho && p.foto_cabeca ? 'do olho e da cabeça' : p.foto_olho ? 'do olho' : 'da cabeça'}</label>` : ''}
    <div class="actions"><button class="btn btn-primary" type="button" data-pdf="${esc(p.id)}">${I.tree}Baixar pedigree em PDF</button><a class="btn btn-ghost" href="#/pedigree">Escolher outro pombo</a></div>
    <p class="hint">Toque em um ancestral para editar os dados dele${faltam ? `, ou em "Cadastrar" para preencher um quadro vazio. ${faltam === 1 ? 'Falta 1 ancestral' : `Faltam ${faltam} ancestrais`}; os quadros vazios saem em branco no PDF` : ''}.</p>
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

// ----- Administrador (só aparece para quem está na tabela administradores) -----
const dataHora = t => t ? new Date(t).toLocaleDateString('pt-BR') : '—';
const tamanho = b => b >= 1048576 ? num(b / 1048576, 1) + ' MB' : num(Math.round((b || 0) / 1024)) + ' KB';

async function carregarAdmin(r) {
  if (!state.admin) return;
  const a = state.adm;
  if (!a.carregado) {
    const [res, us] = await Promise.all([sb.rpc('admin_resumo'), sb.rpc('admin_usuarios')]);
    const err = res.error || us.error;
    if (err) { a.erro = faltaSQL(err.message) ? 'Falta rodar o arquivo 04_admin.sql no Supabase.' : traduzir(err.message); return; }
    const ia = await sb.rpc('admin_leituras_ia');
    Object.assign(a, { carregado: true, erro: null, resumo: res.data, usuarios: us.data || [], ia: ia.error ? null : ia.data });
  }
  if (r.a === 'usuario' && r.b && !a.plantel[r.b]) {
    const { data, error } = await sb.rpc('admin_plantel_do_usuario', { p_usuario: r.b });
    a.plantel[r.b] = error ? { erro: traduzir(error.message) } : { lista: data || [] };
  }
  if (!r.a && a.aba === 'pombos' && !a.pombos) await buscarPombosAdmin();
}

async function buscarPombosAdmin() {
  const a = state.adm;
  const { data, error } = await sb.rpc('admin_pombos', { p_busca: a.busca, p_limite: 200 });
  a.pombos = error ? { erro: traduzir(error.message) } : { lista: data || [] };
}

function itemUsuarioAdmin(u) {
  const titulo = u.nome_pombal || u.nome || u.email;
  const linha2 = [u.nome_pombal && u.nome, u.email, u.cidade].filter(Boolean).join(' · ');
  return `<li><a class="adm-item" href="#/admin/usuario/${u.id}">
    <span class="body"><b>${esc(titulo)}</b><span class="meta">${esc(linha2)}</span>
    <span class="meta">Desde ${dataHora(u.criado_em)} · último acesso ${dataHora(u.ultimo_acesso)}</span></span>
    <span class="side"><span class="tag ${u.ativos ? 'ok' : ''}">${num(u.ativos)} no pombal</span>${u.admin ? '<span class="tag">Admin</span>' : ''}${u.confirmado ? '' : '<span class="tag">E-mail não confirmado</span>'}</span>
  </a></li>`;
}

function listaUsuariosAdminHtml() {
  const q = state.adm.busca.trim().toLowerCase();
  const l = state.adm.usuarios.filter(u => !q || [u.email, u.nome, u.nome_pombal, u.cidade, u.telefone].some(v => v && v.toLowerCase().includes(q)));
  return l.length ? l.map(itemUsuarioAdmin).join('') : '<li class="empty">Nenhum usuário encontrado.</li>';
}

function listaPombosAdminHtml() {
  const p = state.adm.pombos;
  if (!p) return `<li>${carregandoHtml}</li>`;
  if (p.erro) return `<li><p class="msg erro">${esc(p.erro)}</p></li>`;
  if (!p.lista.length) return '<li class="empty">Nenhum pombo encontrado.</li>';
  return p.lista.map(x => `<li><div class="bird ${sexoCls(x.sexo)}"><span class="sexbar"></span>
    <span class="body"><span class="ring">${esc(x.anilha)}</span><span class="name">${esc(x.nome || 'Sem nome')}${x.cor ? ` · <span class="cor">${esc(x.cor)}</span>` : ''}</span>
    <span class="meta">${x.com_quem ? 'Com ' + esc(x.com_quem) : 'Sem pombal ativo'} · ${num(x.pombais)} ${x.pombais === 1 ? 'pombal' : 'pombais'}${x.fotos ? ` · ${x.fotos} foto${x.fotos > 1 ? 's' : ''}` : ''}</span></span>
    <span class="side"><span class="sexsym ${sexoCls(x.sexo)}">${sym(x.sexo)}</span></span></div></li>`).join('') + (p.lista.length >= 200 ? '<li class="hint">Mostrando os 200 mais recentes. Use a busca para achar outros.</li>' : '');
}

function vAdmin(r) {
  if (!state.admin) return shell('admin', 'Administrador', '', '<p class="msg erro">Acesso restrito ao administrador do app.</p>');
  const a = state.adm;
  if (a.erro) return shell('admin', 'Administrador', '', `<p class="msg erro">${esc(a.erro)}</p>`);
  if (!a.carregado) return shell('admin', 'Administrador', '', carregandoHtml);
  if (r.a === 'usuario') {
    const u = a.usuarios.find(x => x.id === r.b);
    if (!u) return shell('admin', 'Usuário', '', '<p class="msg erro">Usuário não encontrado.</p>', { voltar: '#/admin' });
    const pl = a.plantel[r.b];
    const dados = [['E-mail', u.email], ['Nome', u.nome], ['Pombal', u.nome_pombal], ['Cidade', u.cidade], ['Telefone', u.telefone],
      ['Conta criada em', dataHora(u.criado_em)], ['Último acesso', dataHora(u.ultimo_acesso)], ['E-mail confirmado', u.confirmado ? 'Sim' : 'Não'],
      ['Pombos no pombal', num(u.ativos)], ['Total no plantel (com ancestrais)', num(u.no_plantel)], ['Registros no histórico', num(u.registros)]];
    const lista = !pl ? carregandoHtml : pl.erro ? `<p class="msg erro">${esc(pl.erro)}</p>` : pl.lista.length
      ? `<ul class="list grade">${pl.lista.map(x => `<li><div class="bird ${sexoCls(x.sexo)}"><span class="sexbar"></span><span class="body"><span class="ring">${esc(x.anilha)}</span><span class="name">${esc(x.nome || 'Sem nome')}${x.cor ? ` · <span class="cor">${esc(x.cor)}</span>` : ''}</span></span><span class="side"><span class="tag ${x.situacao === 'ativo' ? 'ok' : ''}">${SIT[x.situacao]}</span></span></div></li>`).join('')}</ul>`
      : '<p class="hint">Nenhum pombo cadastrado.</p>';
    return shell('admin', u.nome_pombal || u.nome || u.email, 'Usuário do app', `
      <dl class="adm-dados">${dados.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}</dl>
      <section class="section"><h2>Plantel</h2>${lista}</section>`, { voltar: '#/admin' });
  }
  const s = a.resumo || {};
  const card = (n, rot, extra) => `<div class="adm-card"><b>${num(n || 0)}</b><span>${rot}</span>${extra ? `<small>${extra}</small>` : ''}</div>`;
  const chip = (v, l) => `<button type="button" class="chip" data-adm-aba="${v}" aria-pressed="${a.aba === v}">${l}</button>`;
  const usuarios = a.aba === 'usuarios';
  return shell('admin', 'Administrador', 'Visão geral do app', `
    <div class="adm-cards">
      ${card(s.usuarios, 'usuários', `${num(s.novos_7d || 0)} novos em 7 dias · ${num(s.novos_30d || 0)} em 30`)}
      ${card(s.ativos_30d, 'entraram nos últimos 30 dias', `${num(s.confirmados || 0)} com e-mail confirmado`)}
      ${card(s.pombais, 'pombais com nome', `${num(s.com_pombos || 0)} usuários com pombos`)}
      ${card(s.pombos, 'pombos no app', `${num(s.pombos_ativos || 0)} em algum pombal`)}
      ${card(s.registros, 'registros no histórico', `${num(s.provas || 0)} provas`)}
      ${card(s.fotos, 'fotos', `${tamanho(s.fotos_bytes)} de 1 GB grátis`)}
      ${a.ia ? card(a.ia.mes, 'leituras com IA este mês', `custo aprox. US$ ${num(a.ia.custo_mes, 2)} · ${num(a.ia.usuarios_mes)} usuários · total ${num(a.ia.total)} (US$ ${num(a.ia.custo_total, 2)})`) : ''}
    </div>
    <div class="chips">${chip('usuarios', 'Usuários e pombais')}${chip('pombos', 'Pombos')}</div>
    <div class="search">${I.search}<input class="input" id="q-adm" type="search" placeholder="${usuarios ? 'Buscar por e-mail, nome, pombal ou cidade' : 'Buscar por anilha, nome ou cor'}" value="${esc(a.busca)}" aria-label="Buscar"></div>
    <ul class="list ${usuarios ? 'adm-lista' : 'grade'}" id="lista-adm">${usuarios ? listaUsuariosAdminHtml() : listaPombosAdminHtml()}</ul>
    <button type="button" class="btn btn-ghost" data-adm-atualizar>Atualizar números</button>`);
}

function vConta() {
  const p = state.perfil || {};
  const erro = state.perfilErro ? `<p class="msg erro full" role="alert">${esc(state.perfilErro)}</p>` : '';
  const email = state.session && state.session.user.email;
  return shell('conta', 'Meu pombal', 'Conta e dados do pedigree', `
    <form id="f-perfil" class="form-grid">
      ${erro}
      <p class="hint full">Estes dados vão aparecer no cabeçalho dos pedigrees que você emitir. O nome do pombal, seu nome e a cidade também aparecem no histórico dos pombos que passarem por você (e-mail e telefone não).</p>
      <div class="field"><label for="p-nome">Seu nome</label><input class="input" id="p-nome" maxlength="100" value="${esc(p.nome)}" autocomplete="name"></div>
      <div class="field"><label for="p-pombal">Nome do pombal</label><input class="input" id="p-pombal" maxlength="100" value="${esc(p.nome_pombal)}"></div>
      <div class="field full"><label for="p-cidade">Cidade, estado e país</label><input class="input" id="p-cidade" maxlength="150" value="${esc(p.cidade)}" placeholder="Ex.: Campinas - SP - Brasil"></div>
      <div class="field"><label for="p-email">E-mail de contato</label><input class="input" id="p-email" maxlength="200" type="email" value="${esc(p.email_contato)}"></div>
      <div class="field"><label for="p-tel">Telefone / WhatsApp</label><input class="input" id="p-tel" maxlength="40" type="tel" value="${esc(p.telefone)}"></div>
      <button class="btn btn-primary btn-block full" type="submit" ${state.ocupado ? 'disabled' : ''}>Salvar</button>
    </form>
    <a class="btn btn-ghost btn-block so-celular" href="#/ajuda">${I.help}Ajuda e contato</a>
    <div class="sessao"><p class="hint">Conectado como <b>${esc(email)}</b></p>
    <button class="btn btn-ghost" type="button" data-sair>Sair da conta</button></div>`);
}

// ----- Vacinas -----
const DIAS_AVISO = 7; // avisa a revacinação 7 dias antes
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const SUGESTOES_VACINA = ['Paramixovírus', 'Varíola (bouba)', 'Salmonelose (paratifo)', 'Herpesvírus', 'Adenovírus', 'Rotavírus', 'Influenza'];

function intervaloTxt(dias) {
  if (!dias) return 'Dose única (sem revacinação)';
  if (dias % 365 === 0) return `Revacinar a cada ${dias / 365 === 1 ? 'ano' : dias / 365 + ' anos'}`;
  if (dias % 30 === 0) return `Revacinar a cada ${dias / 30 === 1 ? 'mês' : dias / 30 + ' meses'}`;
  return `Revacinar a cada ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

// Situação de cada pombo do pombal para uma vacina.
// estado: nunca | vencida | chegando | emdia | unica (dose única já tomada)
function situacaoVacina(v) {
  const hoje = hojeISO(), limite = somaDias(hoje, DIAS_AVISO);
  return state.dados.plantel.filter(r => r.situacao === 'ativo').map(r => {
    const p = pombo(r.pombo_id); if (!p) return null;
    const ultima = state.vac.doses.get(v.id + '|' + p.id) || null;
    const proxima = ultima && v.intervalo_dias ? somaDias(ultima, v.intervalo_dias) : null;
    const estado = !ultima ? 'nunca' : !proxima ? 'unica' : proxima <= hoje ? 'vencida' : proxima <= limite ? 'chegando' : 'emdia';
    return { p, ultima, proxima, estado };
  }).filter(Boolean).sort((x, y) => (y.p.ano - x.p.ano) || x.p.numero.localeCompare(y.p.numero, 'pt-BR', { numeric: true }));
}
const precisa = x => ['nunca', 'vencida', 'chegando'].includes(x.estado);

// Aviso na tela Plantel: revacinação vencida ou chegando (só de quem já tomou a vacina).
function avisoVacinasHtml() {
  if (!state.vac.carregado) return '';
  const itens = state.vac.vacinas.filter(v => v.intervalo_dias).map(v => {
    const l = situacaoVacina(v).filter(x => x.estado === 'vencida' || x.estado === 'chegando');
    if (!l.length) return '';
    const venceu = l.some(x => x.estado === 'vencida');
    const data = l.map(x => x.proxima).sort()[0];
    return `<div class="aviso-vac ${venceu ? 'vencida' : ''}">${I.vacina}<p><b>${esc(v.nome)}:</b> ${l.length} ${l.length === 1 ? 'pombo precisa' : 'pombos precisam'} de revacinação ${venceu ? `(venceu em ${dataBR(data)})` : `até ${dataBR(data)}`}.</p>
      <a class="btn btn-primary" href="#/vacinas/vacinar/${esc(v.id)}">Vacinar</a></div>`;
  }).join('');
  return itens ? `<div class="avisos-vac">${itens}</div>` : '';
}

function vVacinas(r) {
  const vc = state.vac;
  const voltar = '#/vacinas';
  if (!state.dados.carregado || !vc.carregado) return shell('vacinas', 'Vacinas', '', erroDados() || (vc.erro ? `<p class="msg erro">${esc(vc.erro)}</p>` : carregandoHtml));
  if (vc.faltaSQL) return shell('vacinas', 'Vacinas', '', '<p class="msg erro">O banco ainda não tem as vacinas: falta rodar o arquivo 09_vacinas.sql no Supabase.</p>');
  if (r.a === 'nova' || r.a === 'editar') {
    const v = r.a === 'editar' ? vc.vacinas.find(x => x.id === r.b) : null;
    if (r.a === 'editar' && !v) return shell('vacinas', 'Vacina', '', '<p class="msg erro">Vacina não encontrada.</p>', { voltar });
    return vFormVacina(v);
  }
  if (r.a === 'vacinar') {
    const v = vc.vacinas.find(x => x.id === r.b);
    if (!v) return shell('vacinas', 'Vacinação', '', '<p class="msg erro">Vacina não encontrada.</p>', { voltar });
    return vVacinar(v);
  }
  const novo = `<a class="icon-btn" href="#/vacinas/nova" aria-label="Cadastrar vacina">${I.plus}</a>`;
  if (!vc.vacinas.length) {
    return shell('vacinas', 'Vacinas', 'Vacinação do plantel', `<div class="vazio">${I.vacina}<h2>Nenhuma vacina cadastrada</h2>
      <p>Cadastre as vacinas que você usa, com a marca e de quanto em quanto tempo revacinar. Depois é só marcar os pombos vacinados de uma vez.</p>
      <a class="btn btn-primary" href="#/vacinas/nova">${I.plus}Cadastrar vacina</a></div>`, { direita: novo });
  }
  const cards = vc.vacinas.map(v => {
    const l = situacaoVacina(v);
    const falta = l.filter(precisa);
    const prox = l.filter(x => x.estado === 'emdia').map(x => x.proxima).sort()[0];
    const status = !l.length ? 'Nenhum pombo no pombal.'
      : falta.length ? `<b>${falta.length}</b> de ${l.length} ${falta.length === 1 ? 'pombo precisa' : 'pombos precisam'} de vacina`
      : prox ? `Todos em dia. Próxima dose a partir de ${dataBR(prox)}.` : 'Todos vacinados.';
    return `<li class="card vac-card">
      <div class="vac-tit"><h2>${esc(v.nome)}</h2>${v.marca ? `<span class="tag">${esc(v.marca)}</span>` : ''}</div>
      <p class="hint">${intervaloTxt(v.intervalo_dias)}</p>
      <p class="vac-status ${falta.length ? 'pendente' : 'ok'}">${status}</p>
      <div class="vac-acoes"><a class="btn btn-primary" href="#/vacinas/vacinar/${esc(v.id)}">${I.vacina}Iniciar vacinação</a><a class="btn btn-ghost" href="#/vacinas/editar/${esc(v.id)}">${I.edit}Editar</a></div>
    </li>`;
  }).join('');
  return shell('vacinas', 'Vacinas', 'Vacinação do plantel', `
    <p class="hint">Só você vê suas vacinas. Cada vacinação vira um registro de Saúde no histórico do pombo. O app avisa na tela Plantel quando a revacinação estiver a ${DIAS_AVISO} dias ou menos.</p>
    <ul class="list vac-lista">${cards}</ul>
    <a class="btn btn-ghost btn-block" href="#/vacinas/nova">${I.plus}Cadastrar outra vacina</a>`, { direita: novo });
}

function vFormVacina(v) {
  let qtd = '', un = 'meses';
  if (v && v.intervalo_dias) {
    const d = v.intervalo_dias;
    if (d % 365 === 0) { qtd = d / 365; un = 'anos'; } else if (d % 30 === 0) { qtd = d / 30; un = 'meses'; } else { qtd = d; un = 'dias'; }
  }
  const unica = v && !v.intervalo_dias;
  const corpo = `<form id="f-vacina" class="form-grid" novalidate>
    ${v ? `<input type="hidden" id="v-id" value="${esc(v.id)}">` : ''}
    <p class="msg erro full" id="v-erro" role="alert" hidden></p>
    <div class="field"><label for="v-nome">Vacina (contra o quê)</label><input class="input" id="v-nome" maxlength="80" list="v-sugestoes" required placeholder="Ex.: Paramixovírus" value="${esc(v && v.nome)}">
      <datalist id="v-sugestoes">${SUGESTOES_VACINA.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
    <div class="field"><label for="v-marca">Marca (opcional)</label><input class="input" id="v-marca" maxlength="80" placeholder="Ex.: Colombovac PMV" value="${esc(v && v.marca)}"></div>
    <div class="field full"><label for="v-qtd">Revacinar a cada</label>
      <div class="vac-intervalo"><input class="input" id="v-qtd" type="number" min="1" max="3650" inputmode="numeric" placeholder="Ex.: 12" value="${esc(qtd)}" ${unica ? 'disabled' : ''}>
        <select class="input" id="v-un" ${unica ? 'disabled' : ''}>${[['dias', 'dias'], ['meses', 'meses'], ['anos', 'anos']].map(([k, l]) => `<option value="${k}" ${k === un ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="check"><input type="checkbox" id="v-unica" ${unica ? 'checked' : ''}> Dose única (não precisa revacinar)</label></div>
    <div class="field full"><label for="v-obs">Observações (opcional)</label><textarea class="input" id="v-obs" maxlength="500" placeholder="Ex.: aplicar no pescoço; reforço antes da temporada">${esc(v && v.observacoes)}</textarea></div>
    <button class="btn btn-primary btn-block full" type="submit">${v ? 'Salvar alterações' : 'Cadastrar vacina'}</button>
  </form>
  ${v ? `<details class="remover"><summary>Apagar esta vacina</summary>
    <p class="hint">As vacinações que você já registrou continuam no histórico dos pombos.</p>
    <button class="btn btn-perigo" type="button" data-vac-apagar="${esc(v.id)}">Apagar vacina</button></details>` : ''}`;
  return shell('vacinas', v ? 'Editar vacina' : 'Cadastrar vacina', v ? v.nome : 'Vacinas do plantel', corpo, { voltar: '#/vacinas' });
}

function itemVacinar(x, marcado) {
  const p = x.p;
  const info = { nunca: 'Ainda não tomou esta vacina', vencida: `Venceu em ${dataBR(x.proxima)}`, chegando: `Vence em ${dataBR(x.proxima)}`,
    emdia: `Em dia até ${dataBR(x.proxima)}`, unica: `Vacinado em ${dataBR(x.ultima)}` }[x.estado];
  return `<li><label class="vac-item ${sexoCls(p.sexo)}">
    <input type="checkbox" name="vac-pombo" value="${esc(p.id)}" ${marcado ? 'checked' : ''}>
    <span class="body"><span class="ring">${esc(anilha(p))}</span><span class="name">${esc(p.nome || 'Sem nome')}</span>
      <span class="meta vac-${x.estado}">${info}${x.ultima && x.estado !== 'unica' ? ` · última dose ${dataBR(x.ultima)}` : ''}</span></span>
  </label></li>`;
}

function vVacinar(v) {
  const l = situacaoVacina(v);
  const falta = l.filter(precisa), ok = l.filter(x => !precisa(x));
  const corpo = !l.length ? '<p class="hint">Nenhum pombo no pombal. Só entram na vacinação os pombos com a situação "Está no meu pombal".</p>' : `
  <form id="f-vacinar" class="vac-form">
    <input type="hidden" id="vc-vacina" value="${esc(v.id)}">
    <p class="msg erro" id="vc-erro" role="alert" hidden></p>
    <div class="field vac-data"><label for="vc-data">Data da vacinação</label><input class="input" id="vc-data" type="date" value="${hojeISO()}" max="${hojeISO()}"></div>
    <section class="section"><div class="vac-cab"><h2>A vacinar (${falta.length})</h2>
      ${falta.length ? '<span><button type="button" class="link" data-vac-marcar="1">Marcar todos</button> · <button type="button" class="link" data-vac-marcar="0">Desmarcar</button></span>' : ''}</div>
      ${falta.length ? `<ul class="list">${falta.map(x => itemVacinar(x, true)).join('')}</ul>` : '<p class="hint">Todos os pombos estão em dia com esta vacina.</p>'}
    </section>
    ${ok.length ? `<details class="vac-emdia"><summary>Em dia (${ok.length}). Toque para ver ou vacinar mesmo assim</summary>
      <ul class="list">${ok.map(x => itemVacinar(x, false)).join('')}</ul></details>` : ''}
    <div class="vac-rodape"><button class="btn btn-primary btn-block" type="submit" id="vc-ok">Confirmar vacinação</button></div>
  </form>`;
  return shell('vacinas', v.nome, `${v.marca ? v.marca + ' · ' : ''}${intervaloTxt(v.intervalo_dias)}`, corpo, { voltar: '#/vacinas' });
}

function contarVacinar() {
  const b = $('#vc-ok'); if (!b) return;
  const n = document.querySelectorAll('input[name="vac-pombo"]:checked').length;
  b.textContent = n ? `Confirmar vacinação de ${n} ${n === 1 ? 'pombo' : 'pombos'}` : 'Marque os pombos vacinados';
  b.disabled = !n;
}

async function carregarVacinas() {
  const [va, vc] = await Promise.all([
    sb.from('vacinas').select('*').order('nome'),
    sb.rpc('minhas_vacinacoes')
  ]);
  const err = va.error || vc.error;
  if (err) {
    state.vac = { carregado: true, faltaSQL: faltaSQL(err.message), erro: faltaSQL(err.message) ? null : traduzir(err.message), vacinas: [], doses: new Map() };
    return;
  }
  state.vac = { carregado: true, faltaSQL: false, erro: null, vacinas: va.data || [],
    doses: new Map((vc.data || []).map(x => [x.vacina_id + '|' + x.pombo_id, x.ultima])) };
}

async function salvarVacina(form) {
  const v = sel => { const el = $(sel); return el ? el.value.trim() : ''; };
  const nome = v('#v-nome');
  if (!nome) return mostrarErro('#v-erro', 'Escreva o nome da vacina.');
  let intervalo = null;
  if (!$('#v-unica').checked) {
    const q = Number(v('#v-qtd'));
    if (!q || q < 1) return mostrarErro('#v-erro', 'Diga de quanto em quanto tempo revacinar, ou marque "Dose única".');
    intervalo = Math.round(q * ({ dias: 1, meses: 30, anos: 365 }[v('#v-un')] || 1));
    if (intervalo > 3650) return mostrarErro('#v-erro', 'O intervalo pode ser de no máximo 10 anos.');
  }
  const reg = { nome, marca: v('#v-marca') || null, intervalo_dias: intervalo, observacoes: v('#v-obs') || null };
  const id = v('#v-id');
  const btn = form.querySelector('[type=submit]'); btn.disabled = true;
  const { error } = id ? await sb.from('vacinas').update(reg).eq('id', id) : await sb.from('vacinas').insert(reg);
  if (error) { btn.disabled = false; return mostrarErro('#v-erro', traduzir(error.message)); }
  await carregarVacinas();
  location.hash = '#/vacinas';
  toast(id ? 'Vacina alterada.' : 'Vacina cadastrada.');
}

async function confirmarVacinacao(form) {
  const ids = [...document.querySelectorAll('input[name="vac-pombo"]:checked')].map(c => c.value);
  if (!ids.length) return mostrarErro('#vc-erro', 'Marque pelo menos um pombo.');
  const data = $('#vc-data').value || hojeISO();
  if (data > hojeISO()) return mostrarErro('#vc-erro', 'A data não pode ser no futuro.');
  const btn = $('#vc-ok'); btn.disabled = true; btn.textContent = 'Registrando…';
  const { data: n, error } = await sb.rpc('registrar_vacinacao', { p_vacina: $('#vc-vacina').value, p_pombos: ids, p_data: data });
  if (error) { contarVacinar(); return mostrarErro('#vc-erro', traduzir(error.message)); }
  await carregarVacinas();
  state.ficha = { id: null };
  location.hash = '#/vacinas';
  toast(n ? `${n} ${n === 1 ? 'pombo vacinado' : 'pombos vacinados'}. Registrado no histórico de cada um.` : 'Esses pombos já tinham esta vacina registrada nessa data.');
}

// ----- Ler pedigree com IA -----
// O app manda a foto/PDF para o servidor (api/ler-pedigree), que usa a IA da Anthropic.
// A chave da IA fica só no servidor. Os pombos lidos aparecem numa prévia para conferir antes de cadastrar.
const lerVazio = () => ({ arquivo: null, nome: '', imagem: null, lendo: false, erro: null, cota: state.ler ? state.ler.cota : undefined,
  pombos: null, aviso: '', modelo: '', salvando: false, progresso: '', resultado: null });
state.ler = lerVazio();
const MAX_PDF = 3 * 1024 * 1024;

// Mesmo jeito do banco de comparar anilhas: número sem símbolos e zeros à esquerda, ano com 4 dígitos.
function chaveAnilha(a) {
  if (!a) return '';
  let ano = Number(a.ano);
  if (ano < 100) ano += ano <= (new Date().getFullYear() % 100) + 1 ? 2000 : 1900;
  const n = String(a.numero || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^0+/, '') || '0';
  return `${String(a.pais || '').toUpperCase()}|${ano}|${n}`;
}
const anilhaLida = p => `${p.numero}/${String(p.ano || '').slice(-2).padStart(2, '0')} ${p.pais}`;
function meuPomboDaAnilha(a) {
  const k = chaveAnilha(a);
  for (const p of state.dados.pombos.values()) if (chaveAnilha(p) === k) return p;
  return null;
}

async function carregarCotaLeitura() {
  const { data, error } = await sb.rpc('minhas_leituras_ia');
  state.ler.cota = error ? { erro: faltaSQL(error.message) ? 'A leitura com IA ainda não foi ativada (falta rodar o arquivo 10_leitura_ia.sql no Supabase).' : traduzir(error.message) } : data;
}

function cotaHtml() {
  const c = state.ler.cota;
  if (c === undefined) return '';
  if (c.erro) return `<p class="msg erro">${esc(c.erro)}</p>`;
  if (c.admin) return `<p class="hint">Você é administrador: leituras sem limite.</p>`;
  const dia = Math.max(0, c.limite_dia - c.hoje), mes = Math.max(0, c.limite_mes - c.mes);
  const resta = Math.min(dia, mes);
  if (!resta) return `<p class="msg erro">Você já usou todas as leituras ${dia ? 'deste mês' : 'de hoje'}. ${dia ? 'No mês que vem' : 'Amanhã'} tem mais.</p>`;
  return `<p class="hint">Você ainda pode fazer <b>${resta}</b> ${resta === 1 ? 'leitura' : 'leituras'} hoje (limite de ${c.limite_dia} por dia e ${c.limite_mes} por mês).</p>`;
}

function vLer() {
  const L = state.ler;
  const titulo = 'Ler pedigree';
  if (!state.dados.carregado) return shell('ler', titulo, '', erroDados() || carregandoHtml, { voltar: '#/plantel' });
  if (L.resultado) return vLerResultado();
  if (L.pombos) return vLerPrevia();
  const semCota = L.cota && (L.cota.erro || (!L.cota.admin && (L.cota.hoje >= L.cota.limite_dia || L.cota.mes >= L.cota.limite_mes)));
  const arquivo = L.arquivo ? `<div class="ler-arquivo">${L.imagem ? `<img src="${esc(L.imagem)}" alt="Pedigree escolhido">` : `<span class="ler-pdf">PDF</span>`}
      <b>${esc(L.nome)}</b></div>` : '';
  return shell('ler', titulo, 'Foto ou PDF, com inteligência artificial', `
    <section class="card ler-card">
      <p>Tire uma foto do pedigree ou escolha o PDF. A inteligência artificial lê as anilhas, os nomes e os pais, e mostra tudo para você <b>conferir antes de cadastrar</b>.</p>
      <ul class="ler-dicas hint"><li>Foto de frente, com boa luz, sem sombra e sem cortar as bordas.</li><li>Se tiver o PDF, ele dá o melhor resultado.</li><li>Lê até os trisavós (5 gerações).</li></ul>
      ${arquivo}
      <label class="btn ${L.arquivo ? 'btn-ghost' : 'btn-primary'} ler-escolher">${I.camera}${L.arquivo ? 'Trocar a foto ou o PDF' : 'Escolher foto ou PDF'}
        <input type="file" id="ler-arquivo" accept="image/*,application/pdf" hidden></label>
      ${L.erro ? `<p class="msg erro" role="alert">${esc(L.erro)}</p>` : ''}
      ${state.admin && L.arquivo ? `<div class="field"><label for="ler-modelo">Modelo da IA (só o administrador vê)</label>
        <select class="input" id="ler-modelo"><option value="claude-haiku-5-5">Haiku 5.5 (mais barato)</option><option value="claude-sonnet-5-5" ${L.modelo === 'claude-sonnet-5-5' ? 'selected' : ''}>Sonnet 5.5 (mais preciso)</option></select></div>` : ''}
      ${L.arquivo ? `<button type="button" class="btn btn-primary btn-block" data-ler-iniciar ${L.lendo || semCota ? 'disabled' : ''}>${L.lendo ? 'Lendo o pedigree… pode levar até 1 minuto' : 'Ler o pedigree'}</button>` : ''}
      ${cotaHtml()}
    </section>`, { voltar: '#/plantel' });
}

function vLerPrevia() {
  const L = state.ler;
  const principal = L.pombos.find(p => p.posicao === 1);
  const itens = L.pombos.map(p => {
    const n = p.posicao, f = n % 2 === 1 && n > 1;
    const ja = meuPomboDaAnilha(p);
    const rot = n === 1 ? 'Pombo do pedigree' : rotuloPos(n);
    return `<li class="ler-item ${n === 1 ? (p.sexo === 'F' ? 'f' : 'm') : f ? 'f' : 'm'}" data-pos="${n}">
      <div class="ler-topo">${n === 1 ? `<b>${rot}</b>` : `<label class="check"><input type="checkbox" name="ler-inc" value="${n}" checked> <b>${rot}</b></label>`}
        ${ja && meuRegistro(ja.id) ? '<span class="tag ok">Já está no seu plantel</span>' : ''}</div>
      ${ja && meuRegistro(ja.id) ? '<p class="hint">Só completa o que estiver em branco no cadastro que você já tem.</p>' : ''}
      <div class="ler-campos">
        <div class="field"><label for="l-an-${n}">Anilha</label><input class="input mono" id="l-an-${n}" maxlength="40" value="${esc(anilhaLida(p))}" autocomplete="off"></div>
        <div class="field"><label for="l-nome-${n}">Nome</label><input class="input" id="l-nome-${n}" maxlength="80" value="${esc(p.nome)}"></div>
        <div class="field"><label for="l-cor-${n}">Cor</label><input class="input" id="l-cor-${n}" maxlength="60" list="cores" value="${esc(p.cor)}"></div>
        ${n === 1 ? `<div class="field"><label for="l-sexo-1">Sexo</label><select class="input" id="l-sexo-1"><option value="">Não informado</option><option value="M" ${p.sexo === 'M' ? 'selected' : ''}>♂ Macho</option><option value="F" ${p.sexo === 'F' ? 'selected' : ''}>♀ Fêmea</option></select></div>
          <div class="field"><label for="l-nasc-1">Nascimento</label><input class="input" id="l-nasc-1" type="date" value="${esc(p.nascimento)}"></div>` : ''}
        <div class="field ler-obs"><label for="l-obs-${n}">Títulos e observações</label><textarea class="input" id="l-obs-${n}" maxlength="4000" rows="2">${esc(p.observacoes)}</textarea></div>
      </div></li>`;
  }).join('');
  const n = L.pombos.length;
  return shell('ler', 'Confira o que a IA leu', `${n} ${n === 1 ? 'pombo encontrado' : 'pombos encontrados'}`, `
    <form id="f-ler" class="ler-form" novalidate>
      <p class="msg info">Confira principalmente as <b>anilhas</b>: a IA pode errar um número. Corrija o que precisar antes de cadastrar.${L.modelo && state.admin ? ` <span class="hint">(modelo: ${esc(L.modelo)})</span>` : ''}</p>
      ${L.aviso ? `<p class="msg erro">${esc(L.aviso)}</p>` : ''}
      ${!principal ? '<p class="msg erro">A IA não achou o pombo principal do pedigree. Tente outra foto ou cadastre pelo botão Cadastrar.</p>' : `
      <div class="field ler-sit"><label for="l-sit">O pombo ${esc(anilhaLida(principal))} é</label><select class="input" id="l-sit">${SIT_FORM.map(([v, l]) => `<option value="${v}" ${v === 'ativo' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
      <p class="msg erro" id="l-erro" role="alert" hidden></p>
      <datalist id="cores">${CORES.map(c => `<option value="${c}">`).join('')}</datalist>
      <ul class="ler-lista">${itens}</ul>
      <p class="hint">Desmarcar um ancestral tira também os pais dele. O que faltar você pode cadastrar depois, tocando no quadro vazio do pedigree.</p>
      <div class="vac-rodape ler-rodape">${principal ? `<button class="btn btn-primary btn-block" type="submit" id="l-ok">Cadastrar</button>` : ''}
        <button class="btn btn-ghost btn-block" type="button" data-ler-outro>Ler outro pedigree</button></div>
    </form>`, { voltar: '#/ler' });
}

function vLerResultado() {
  const R = state.ler.resultado;
  return shell('ler', 'Pedigree cadastrado', '', `
    <section class="card ler-card">
      <p class="msg ${R.erros.length ? 'erro' : 'ok'}">${R.salvos ? `<b>${R.salvos} ${R.salvos === 1 ? 'pombo cadastrado' : 'pombos cadastrados'}</b> e ligados como pais e filhos.` : 'Nenhum pombo foi cadastrado.'}</p>
      ${R.erros.length ? `<div class="msg erro"><p>Não deu para cadastrar:</p><ul>${R.erros.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      <div class="actions">${R.pomboId ? `<a class="btn btn-primary" href="#/pedigree/${esc(R.pomboId)}">${I.tree}Ver o pedigree</a><a class="btn btn-ghost" href="#/pombo/${esc(R.pomboId)}">Abrir a ficha</a>` : ''}</div>
      <button type="button" class="btn btn-ghost btn-block" data-ler-outro>Ler outro pedigree</button>
    </section>`, { voltar: '#/plantel' });
}

function contarLer() {
  const b = $('#l-ok'); if (!b) return;
  const n = posicoesIncluidas().length;
  b.textContent = `Cadastrar ${n} ${n === 1 ? 'pombo' : 'pombos'}`;
}

// Posições marcadas. Se um ancestral foi desmarcado, os pais dele também ficam de fora.
function posicoesIncluidas() {
  const marcado = new Set([1]);
  document.querySelectorAll('input[name="ler-inc"]').forEach(c => { if (c.checked) marcado.add(Number(c.value)); });
  const lidas = (state.ler.pombos || []).map(p => p.posicao).sort((a, b) => a - b);
  const inc = new Set();
  for (const n of lidas) if (marcado.has(n) && (n === 1 || inc.has(n >> 1))) inc.add(n);
  return [...inc];
}

function escolherArquivoLer(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const L = state.ler;
  if (L.imagem) URL.revokeObjectURL(L.imagem);
  const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  if (pdf && f.size > MAX_PDF) { L.erro = 'Este PDF é grande demais (o limite é 3 MB). Tente tirar uma foto da folha.'; render(); return; }
  if (!pdf && !/^image\//.test(f.type)) { L.erro = 'Escolha uma foto (JPG, PNG) ou um PDF.'; render(); return; }
  Object.assign(L, { arquivo: f, nome: f.name || (pdf ? 'pedigree.pdf' : 'foto'), imagem: pdf ? null : URL.createObjectURL(f), erro: null });
  render();
}

const paraBase64 = blob => new Promise((ok, falha) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => falha(new Error('Não consegui abrir o arquivo.'));
  r.readAsDataURL(blob);
});

async function lerPedigree() {
  const L = state.ler;
  if (!L.arquivo || L.lendo) return;
  L.modelo = $('#ler-modelo') ? $('#ler-modelo').value : '';
  L.lendo = true; L.erro = null; render();
  try {
    const f = L.arquivo;
    const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    // Foto: diminui para no máximo 2000 px (fica menor que 1 MB e a IA lê bem).
    const blob = pdf ? f : await comprimirFoto(f, 2000, 0.85);
    const corpo = { tipo: pdf ? 'application/pdf' : 'image/jpeg', arquivo: await paraBase64(blob), modelo: L.modelo || undefined };
    const { data: s } = await sb.auth.getSession();
    if (!s.session) throw new Error('Sua sessão expirou. Entre de novo.');
    let r;
    try {
      r = await fetch('api/ler-pedigree', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.session.access_token }, body: JSON.stringify(corpo) });
    } catch (e) { throw new Error('Sem conexão com a internet. Tente de novo.'); }
    const resp = await r.json().catch(() => null);
    if (!r.ok || !resp) throw new Error((resp && resp.erro) || (r.status === 404 ? 'A leitura com IA ainda não está disponível neste endereço.' : r.status === 413 ? 'Arquivo grande demais.' : 'A leitura falhou. Tente de novo.'));
    if (!resp.pombos.length) throw new Error(resp.aviso || 'A IA não encontrou nenhum pombo nesta imagem. Tente uma foto mais nítida.');
    Object.assign(L, { pombos: resp.pombos, aviso: resp.aviso || '', modelo: resp.modelo || '' });
  } catch (err) {
    L.erro = err.message || String(err);
  }
  L.lendo = false;
  render();
  window.scrollTo(0, 0);
  carregarCotaLeitura().then(() => { if (rota().nome === 'ler' && !state.ler.pombos) render(); });
}

// Cadastra os pombos lidos: primeiro os mais antigos (trisavós), por último o pombo do pedigree,
// para cada um já encontrar o pai e a mãe cadastrados.
async function salvarLeitura(form) {
  const L = state.ler;
  const v = sel => { const el = $(sel); return el ? el.value.trim() : ''; };
  const inc = posicoesIncluidas();
  const lidos = new Map();
  for (const n of inc) {
    const a = lerAnilha(v(`#l-an-${n}`));
    if (!a) return mostrarErro('#l-erro', `${n === 1 ? 'Pombo do pedigree' : rotuloPos(n)}: falta a anilha. Escreva ou desmarque este pombo.`);
    if (a.erro || !/^\d{2}(\d{2})?$/.test(a.ano)) return mostrarErro('#l-erro', `${n === 1 ? 'Pombo do pedigree' : rotuloPos(n)}: ${a.erro || 'confira o ano da anilha.'}`);
    lidos.set(n, { anel: a, nome: v(`#l-nome-${n}`), cor: v(`#l-cor-${n}`), obs: v(`#l-obs-${n}`),
      sexo: n === 1 ? v('#l-sexo-1') : (n % 2 === 0 ? 'M' : 'F'), nascimento: n === 1 ? v('#l-nasc-1') : '' });
  }
  const situacao = v('#l-sit') || 'ativo';
  const btn = $('#l-ok');
  btn.disabled = true;
  const erros = [];
  const salvos = new Map(); // chave da anilha -> dados enviados (o mesmo ancestral pode aparecer duas vezes)
  let pomboId = null, total = 0;
  const ordem = [...inc].sort((a, b) => b - a);
  for (let i = 0; i < ordem.length; i++) {
    const n = ordem[i], l = lidos.get(n);
    btn.textContent = `Cadastrando ${i + 1} de ${ordem.length}…`;
    const anel = x => x ? { numero: x.numero, ano: String(x.ano), pais: x.pais } : null;
    const pai = lidos.has(2 * n) ? anel(lidos.get(2 * n).anel) : null;
    const mae = lidos.has(2 * n + 1) ? anel(lidos.get(2 * n + 1).anel) : null;
    const k = chaveAnilha(l.anel);
    const ex = meuPomboDaAnilha(l.anel), reg = ex && meuRegistro(ex.id);
    let d;
    if (salvos.has(k)) {
      const b = salvos.get(k);
      d = Object.assign({}, b, { pai: b.pai || pai, mae: b.mae || mae, nome: b.nome || l.nome, cor: b.cor || l.cor, observacoes: b.observacoes || l.obs });
      if (n === 1) d.situacao = situacao;
    } else if (reg) {
      // Já está no meu plantel: mantém o que eu já tinha e só completa o que está em branco.
      const sit = n === 1 && reg.situacao === 'referencia' ? situacao : reg.situacao;
      d = { plantel_id: reg.id, numero: ex.numero, ano: String(ex.ano), pais: ex.pais,
        nome: ex.nome || l.nome, sexo: ex.sexo || l.sexo, cor: ex.cor || l.cor, nascimento: ex.nascimento || l.nascimento,
        pai: ex.pai_id ? anel(pombo(ex.pai_id)) : pai, mae: ex.mae_id ? anel(pombo(ex.mae_id)) : mae,
        situacao: sit, origem: sit === 'referencia' ? '' : reg.origem || '', origem_obs: sit === 'referencia' ? '' : reg.origem_obs || '',
        data_entrada: sit === 'referencia' ? '' : reg.data_entrada || '', data_saida: reg.data_saida || '', saida_obs: reg.saida_obs || '',
        observacoes: reg.observacoes || l.obs };
    } else {
      const sit = n === 1 ? situacao : 'referencia';
      d = { plantel_id: null, numero: l.anel.numero, ano: l.anel.ano, pais: l.anel.pais,
        nome: l.nome, sexo: l.sexo, cor: l.cor, nascimento: l.nascimento, pai, mae, situacao: sit,
        origem: '', origem_obs: '', data_entrada: '', data_saida: '', saida_obs: '', observacoes: l.obs };
    }
    const { data, error } = await sb.rpc('salvar_pombo', { d });
    if (error) { erros.push(`${anilhaLida(l.anel)} (${n === 1 ? 'pombo do pedigree' : rotuloPos(n).toLowerCase()}): ${traduzir(error.message)}`); continue; }
    if (!salvos.has(k)) total++;
    salvos.set(k, Object.assign({}, d, { plantel_id: data.plantel_id }));
    if (n === 1) pomboId = data.pombo_id;
  }
  await recarregarTudo(pomboId);
  state.ficha = { id: null };
  L.resultado = { salvos: total, erros, pomboId };
  render();
  window.scrollTo(0, 0);
  toast(erros.length ? 'Alguns pombos não foram cadastrados.' : 'Pedigree cadastrado.');
}

// ----- Ajuda -----
function vAjuda() {
  const q = (t, r) => `<details class="faq"><summary>${t}</summary><p>${r}</p></details>`;
  return shell('ajuda', 'Ajuda', 'Dúvidas e contato', `
    <section class="card ajuda-contato"><h2>Fale com a gente</h2>
      <p class="hint">Tem uma dúvida, achou um erro ou quer sugerir uma melhoria? Mande uma mensagem.</p>${contatosHtml()}</section>
    <section class="section"><h2>Perguntas frequentes</h2>
      ${q('Como cadastro um pombo?', 'Toque em <b>Cadastrar</b>, digite a anilha (ex.: 1402317/23 BRA) e preencha o que souber. Se a anilha já foi usada por outro pombal no app, o histórico dela aparece na hora.')}
      ${q('Comprei um pombo que já está no app. Preciso digitar os pais e avós?', 'Não. Ao digitar a anilha em <b>Cadastrar</b>, se outro criador já cadastrou os ancestrais dele, aparece a opção <b>Copiar os ancestrais</b>. Eles viram uma cópia sua, que você pode mudar sem mexer no cadastro do outro criador. As fotos e os dados do outro criador não são copiados.')}
      ${q('Como funciona a vacinação?', 'Em <b>Vacinas</b>, cadastre cada vacina com a marca e de quanto em quanto tempo revacinar. Toque em <b>Iniciar vacinação</b>: aparece a lista dos pombos que precisam da vacina, já marcados. Confirme e cada um ganha um registro de Saúde no histórico. Eles saem da lista até a próxima dose, e o app avisa na tela Plantel quando a revacinação estiver chegando.')}
      ${q('O que são os ancestrais?', 'São os pais, avós e outros pombos que você cadastra só para montar o pedigree. Eles ficam guardados, mas não contam no seu plantel. Para vê-los, use o filtro <b>Ancestrais</b> na tela Plantel. Se um ancestral estiver no seu pombal, edite o pombo e mude a situação para "Está no meu pombal".')}
      ${q('Vendi, cedi ou perdi um pombo. O que faço?', 'Edite o pombo e mude a situação (vendido, cedido, perdido ou morreu). Assim a passagem dele pelo seu pombal fica registrada. Use "Tirar do meu plantel" só se cadastrou por engano. Mesmo assim, o histórico dele fica guardado.')}
      ${q('Quem vê o histórico do pombo?', 'O histórico (provas, prêmios, saúde, reprodução, entradas e saídas) é compartilhado com todos os pombais que tiverem a mesma anilha. Cada registro só pode ser alterado ou apagado por quem o cadastrou.')}
      ${q('Quem vê o nome, a cor, os pais e as fotos do meu pombo?', 'Só você. Se outro pombal cadastrar a mesma anilha, ele tem a cópia dele desses dados, e o que ele mudar não aparece para você.')}
      ${q('Dá para cadastrar a partir de um pedigree que já tenho?', 'Sim. Toque em <b>Ler pedigree</b> (na tela Plantel ou em Cadastrar), tire uma foto do pedigree ou escolha o PDF. A inteligência artificial lê as anilhas, nomes, cores e títulos até os trisavós e mostra tudo para você conferir e corrigir. Ao confirmar, o pombo e os ancestrais são cadastrados já ligados como pais e filhos. Confira sempre as anilhas, porque a leitura pode errar. Há um limite de leituras por dia e por mês.')}
      ${q('Como emito o pedigree?', 'Toque em <b>Pedigree</b>, escolha o pombo e baixe o PDF. Ele sai com 5 gerações. No cabeçalho vão os dados de <a href="#/conta">Meu pombal</a>.')}
      ${q('Como coloco as fotos do olho e da cabeça?', 'Abra a ficha do pombo e use a parte de fotos. Dá para tirar a foto na hora ou escolher da galeria.')}
    </section>`);
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
  else if (r.nome === 'ajuda') html = vAjuda();
  else if (r.nome === 'vacinas') html = vVacinas(r);
  else if (r.nome === 'ler') html = vLer();
  else if (r.nome === 'admin') html = vAdmin(r);
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
  contarVacinar();
  ajustarCamposTipo();
  contarLer();
}

// ---------- Dados ----------
const faltaSQL = m => /relation|schema cache|does not exist|could not find the function/i.test(m || '');

async function carregarPerfil() {
  state.perfilErro = null;
  if (!state.session) { state.perfil = null; state.admin = false; return; }
  const { data, error } = await sb.from('perfis').select('*').eq('id', state.session.user.id).maybeSingle();
  if (error) {
    state.perfil = null;
    state.perfilErro = faltaSQL(error.message)
      ? 'O banco de dados ainda não foi preparado (falta rodar o SQL no Supabase).'
      : traduzir(error.message);
    return;
  }
  state.perfil = data;
  const adm = await sb.rpc('sou_admin');
  state.admin = !adm.error && adm.data === true;
}

async function carregarPlantel() {
  if (!state.session) { state.dados = { carregado: false, erro: null, plantel: [], pombos: new Map() }; return; }
  const [pl, po] = await Promise.all([
    sb.from('plantel').select('*'),
    sb.rpc('meus_pombos')
  ]);
  const err = pl.error || po.error;
  if (err) {
    state.dados = { carregado: false, plantel: [], pombos: new Map(),
      erro: faltaSQL(err.message) ? 'O banco de dados ainda não tem o plantel: falta rodar o arquivo 02_plantel_historico.sql no Supabase.' : traduzir(err.message) };
    return;
  }
  state.dados = { carregado: true, erro: null, plantel: pl.data || [], pombos: new Map((po.data || []).map(p => [p.id, p])) };
}

// Lista de filhos ou irmãos (resultado de filhos_do_pombo).
function listaParentes(l) {
  return `<ul class="list">${l.map(c => {
    const conteudo = `<span class="sexbar"></span><span class="body"><span class="ring">${esc(c.anilha)}</span><span class="name">${esc(c.nome || 'Sem nome')}${c.cor ? ` · <span class="cor">${esc(c.cor)}</span>` : ''}</span><span class="meta">${c.pombais ? esc(c.pombais) : 'Sem pombal ativo'}</span></span><span class="side"><span class="sexsym ${sexoCls(c.sexo)}">${sym(c.sexo)}</span></span>`;
    return `<li>${c.visivel ? `<a class="bird ${sexoCls(c.sexo)}" href="#/pombo/${c.id}">${conteudo}</a>` : `<div class="bird ${sexoCls(c.sexo)}">${conteudo}</div>`}</li>`;
  }).join('')}</ul>`;
}

// Irmãos = filhos do pai e da mãe (sem o próprio pombo).
// Inteiros: filhos dos dois; meio-irmãos: filhos só de um deles.
function separarIrmaos(id, doPai, daMae) {
  const fora = l => (l || []).filter(c => c.id !== id);
  const pai = fora(doPai), mae = fora(daMae);
  const idsMae = new Set(mae.map(c => c.id)), idsPai = new Set(pai.map(c => c.id));
  return {
    inteiros: pai.filter(c => idsMae.has(c.id)),
    pai: pai.filter(c => !idsMae.has(c.id)),
    mae: mae.filter(c => !idsPai.has(c.id))
  };
}

const fichaVazia = id => ({ id, carregando: true, erro: null, eventos: [], donos: [], filhos: [], irmaos: { inteiros: [], pai: [], mae: [] } });

async function carregarFicha(id) {
  state.ficha = fichaVazia(id);
  const p = pombo(id);
  const semNada = Promise.resolve({ data: [], error: null });
  const [ev, dn, fl, fp, fm] = await Promise.all([
    sb.from('eventos').select('*').eq('pombo_id', id).order('data', { ascending: true, nullsFirst: false }).order('criado_em', { ascending: true }),
    sb.rpc('donos_do_pombo', { p: id }),
    sb.rpc('filhos_do_pombo', { p: id }),
    p && p.pai_id ? sb.rpc('filhos_do_pombo', { p: p.pai_id }) : semNada,
    p && p.mae_id ? sb.rpc('filhos_do_pombo', { p: p.mae_id }) : semNada
  ]);
  if (p) await carregarUrlsFotos([p.foto_olho, p.foto_cabeca]);
  if (state.ficha.id !== id) return;
  const err = ev.error || dn.error || fl.error || fp.error || fm.error;
  state.ficha = { id, carregando: false, erro: err ? traduzir(err.message) : null, eventos: ev.data || [], donos: dn.data || [], filhos: fl.data || [],
    irmaos: separarIrmaos(id, fp.data, fm.data) };
}

// Carrega o que a tela atual precisa e redesenha.
async function abrirRota() {
  const r = rota();
  if (r.nome === 'admin') { await carregarAdmin(r); render(); return; }
  if (!state.dados.carregado && !state.dados.erro) { await carregarPlantel(); }
  if (!state.vac.carregado && ['plantel', 'vacinas'].includes(r.nome)) await carregarVacinas();
  if (r.nome === 'ler' && !state.ler.pombos && !state.ler.resultado) await carregarCotaLeitura();
  let pid = null;
  if (r.nome === 'pombo' || r.nome === 'evento') pid = r.a;
  if (r.nome === 'editar') { const reg = state.dados.plantel.find(x => x.id === r.a); pid = reg && reg.pombo_id; }
  if (pid && state.ficha.id !== pid) { state.ficha = fichaVazia(pid); render(); await carregarFicha(pid); }
  render();
}

async function recarregarTudo(pid) {
  await carregarPlantel();
  if (pid) await carregarFicha(pid);
}

// ---------- Eventos ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-ler-iniciar],[data-ler-outro],[data-vac-apagar],[data-vac-marcar],[data-adm-aba],[data-adm-atualizar],[data-foto-remover],[data-pdf],[data-auth],[data-sair],[data-filtro],[data-hist],[data-sexo],[data-remover],[data-apagar-evento]');
  if (!t) return;
  const d = t.dataset;
  if (d.fotoRemover) { removerFoto(t); return; }
  if (t.hasAttribute('data-ler-iniciar')) { lerPedigree(); return; }
  if (t.hasAttribute('data-ler-outro')) {
    if (state.ler.imagem) URL.revokeObjectURL(state.ler.imagem);
    state.ler = lerVazio();
    if (location.hash !== '#/ler') { location.hash = '#/ler'; return; }
    render(); window.scrollTo(0, 0);
    carregarCotaLeitura().then(render);
    return;
  }
  if (d.vacMarcar) { document.querySelectorAll('.vac-form > .section input[name="vac-pombo"]').forEach(c => { c.checked = d.vacMarcar === '1'; }); contarVacinar(); return; }
  if (d.vacApagar) {
    if (!confirm('Apagar esta vacina? As vacinações já registradas continuam no histórico dos pombos.')) return;
    t.disabled = true;
    const { error } = await sb.from('vacinas').delete().eq('id', d.vacApagar);
    if (error) { t.disabled = false; toast(traduzir(error.message)); return; }
    await carregarVacinas();
    location.hash = '#/vacinas';
    toast('Vacina apagada.');
    return;
  }
  if (d.admAba) { state.adm.aba = d.admAba; state.adm.busca = ''; render(); if (d.admAba === 'pombos' && !state.adm.pombos) { await buscarPombosAdmin(); render(); } return; }
  if (t.hasAttribute('data-adm-atualizar')) { state.adm = Object.assign(state.adm, { carregado: false, pombos: null, plantel: {} }); render(); await abrirRota(); toast('Números atualizados.'); return; }
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
    if (!confirm('Tirar este pombo do seu plantel? O histórico dele fica guardado.')) return;
    t.disabled = true;
    const { data: fotosApagar, error } = await sb.rpc('remover_do_plantel', { p_plantel: d.remover });
    if (error) { t.disabled = false; toast(traduzir(error.message)); return; }
    if (Array.isArray(fotosApagar) && fotosApagar.length) sb.storage.from('fotos').remove(fotosApagar);
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
  if (e.target.id === 'q-adm') {
    state.adm.busca = e.target.value;
    if (state.adm.aba === 'usuarios') $('#lista-adm').innerHTML = listaUsuariosAdminHtml();
    else { clearTimeout(buscaAdmT); buscaAdmT = setTimeout(async () => { await buscarPombosAdmin(); if ($('#lista-adm')) $('#lista-adm').innerHTML = listaPombosAdminHtml(); }, 350); }
  }
  if (e.target.id === 'q-ped') { state.q = e.target.value; $('#lista-ped').innerHTML = listaPedigreeHtml(); }
  if (['f-num', 'f-ano', 'f-pais'].includes(e.target.id)) verificarAnilha();
});

document.addEventListener('change', e => {
  if (e.target.matches('input[data-foto]')) enviarFoto(e.target);
  if (e.target.id === 'f-sit') ajustarCamposSituacao();
  if (e.target.id === 'e-tipo') ajustarCamposTipo();
  if (e.target.name === 'vac-pombo') contarVacinar();
  if (e.target.id === 'ler-arquivo') escolherArquivoLer(e.target);
  if (e.target.name === 'ler-inc') contarLer();
  if (e.target.id === 'v-unica') { $('#v-qtd').disabled = $('#v-un').disabled = e.target.checked; }
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
  const falhou = msg => {
    btn.disabled = false; btn.textContent = rotulo;
    return mostrarErro('#f-erro', faltaSQL(msg) ? 'O banco de dados ainda não tem o plantel: falta rodar o arquivo 02_plantel_historico.sql no Supabase.' : traduzir(msg));
  };
  // Cadastro de ancestral pelo pedigree: primeiro liga a anilha ao filho, depois grava os dados do ancestral.
  const filhoId = v('#f-filho');
  if (filhoId) {
    const f = pombo(filhoId), lado = v('#f-lado') === 'mae' ? 'mae' : 'pai';
    if (!f) return falhou('O pombo filho não foi encontrado. Volte ao pedigree e tente de novo.');
    const regF = meuRegistro(filhoId);
    const anel = x => x ? { numero: x.numero, ano: String(x.ano), pais: x.pais } : null;
    const ligar = {
      plantel_id: regF ? regF.id : null, numero: f.numero, ano: String(f.ano), pais: f.pais,
      nome: f.nome || '', sexo: f.sexo || '', cor: f.cor || '', nascimento: f.nascimento || '',
      pai: lado === 'pai' ? { numero: dados.numero, ano: dados.ano, pais: dados.pais } : anel(pombo(f.pai_id)),
      mae: lado === 'mae' ? { numero: dados.numero, ano: dados.ano, pais: dados.pais } : anel(pombo(f.mae_id)),
      situacao: regF ? regF.situacao : 'referencia',
      origem: regF ? regF.origem || '' : '', origem_obs: regF ? regF.origem_obs || '' : '',
      data_entrada: regF ? regF.data_entrada || '' : '', data_saida: regF ? regF.data_saida || '' : '',
      saida_obs: regF ? regF.saida_obs || '' : '', observacoes: regF ? regF.observacoes || '' : ''
    };
    const lig = await sb.rpc('salvar_pombo', { d: ligar });
    if (lig.error) return falhou(lig.error.message);
    await carregarPlantel();
    const novo = pombo(lado === 'pai' ? pombo(filhoId).pai_id : pombo(filhoId).mae_id);
    const regNovo = novo && meuRegistro(novo.id);
    if (regNovo) dados.plantel_id = regNovo.id;
  }
  const copiar = !dados.plantel_id && $('#f-copiar') && $('#f-copiar').checked;
  const { data, error } = await sb.rpc('salvar_pombo', { d: dados });
  if (error) return falhou(error.message);
  let copiados = 0, erroCopia = null;
  if (copiar) {
    const c = await sb.rpc('copiar_ancestrais', { p_pombo: data.pombo_id });
    if (c.error) erroCopia = traduzir(c.error.message); else copiados = c.data || 0;
  }
  await recarregarTudo(data.pombo_id);
  const volta = v('#f-volta');
  if (volta) state.ficha = { id: null };
  location.hash = volta ? '#/' + volta : '#/pombo/' + data.pombo_id;
  if (filhoId) toast('Ancestral cadastrado e ligado no pedigree.');
  else if (erroCopia) toast('Pombo cadastrado, mas não deu para copiar os ancestrais: ' + erroCopia);
  else if (copiados) toast('Pombo cadastrado e ancestrais copiados. Confira no pedigree.');
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
  if (id === 'f-vacina') return salvarVacina(e.target);
  if (id === 'f-vacinar') return confirmarVacinacao(e.target);
  if (id === 'f-ler') return salvarLeitura(e.target);
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
      state.vac = { carregado: false, faltaSQL: false, erro: null, vacinas: [], doses: new Map() };
      state.adm = { carregado: false, erro: null, resumo: null, usuarios: [], aba: 'usuarios', busca: '', pombos: null, plantel: {} };
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
