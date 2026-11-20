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
  ocupado: false
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
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'
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
      ${criar ? '<p class="hint">A senha precisa ter pelo menos 6 caracteres. Cada conta vê só os próprios pombos.</p>' : '<button type="button" class="link" data-auth="esqueci">Esqueci minha senha</button>'}
    </form>`;
  }
  return `<div class="wrap login view">
    <div class="brand"><img src="img/icone.svg" alt=""><h1>${esc(C.nomeApp)}</h1><p>Cadastre seu plantel e emita pedigrees com a árvore completa.</p></div>
    ${form}
    ${credito()}
  </div>`;
}

// ---------- Telas internas ----------
function rotaAtual() {
  const r = location.hash.replace(/^#\/?/, '').split(/[?&]/)[0];
  return ['plantel', 'pedigree', 'conta'].includes(r) ? r : 'plantel';
}

function shell(rota, titulo, sub, corpo) {
  const aba = (r, ico, label) => `<a href="#/${r}" ${rota === r ? 'aria-current="page"' : ''}>${ico}<span>${label}</span></a>`;
  return `<header class="topbar wrap"><h1>${esc(titulo)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1></header>
  <main class="view wrap"><div class="stack">${corpo}${credito()}</div></main>
  <nav class="tabbar" aria-label="Menu">${aba('plantel', I.list, 'Plantel')}${aba('pedigree', I.tree, 'Pedigree')}${aba('conta', I.user, 'Meu pombal')}</nav>`;
}

const nomePombal = () => (state.perfil && state.perfil.nome_pombal) || 'Meu pombal';
const primeiroNome = () => ((state.perfil && state.perfil.nome) || '').trim().split(/\s+/)[0];

function vPlantel() {
  const ola = primeiroNome() ? `Olá, ${esc(primeiroNome())}!` : 'Olá!';
  return shell('plantel', 'Plantel', nomePombal(), `
    <p class="boasvindas">${ola} Sua conta está pronta.</p>
    <div class="vazio">${I.list}<h2>Cadastro de pombos em breve</h2>
      <p>A próxima etapa do app traz o cadastro do plantel: anilha, nome, sexo, cor, pai e mãe.</p></div>
    <a class="btn btn-ghost btn-block" href="#/conta">Preencher dados do meu pombal</a>`);
}

function vPedigree() {
  return shell('pedigree', 'Pedigree', nomePombal(), `
    <div class="vazio">${I.tree}<h2>Pedigree em breve</h2>
      <p>Depois do cadastro dos pombos, aqui você vai gerar o PDF do pedigree com 5 gerações.</p></div>`);
}

function vConta() {
  const p = state.perfil || {};
  const erro = state.perfilErro ? `<p class="msg erro" role="alert">${esc(state.perfilErro)}</p>` : '';
  const email = state.session && state.session.user.email;
  return shell('conta', 'Meu pombal', 'Conta e dados do pedigree', `
    <form id="f-perfil" class="stack" style="padding:0">
      ${erro}
      <p class="hint">Estes dados vão aparecer no cabeçalho dos pedigrees que você emitir.</p>
      <div class="field"><label for="p-nome">Seu nome</label><input class="input" id="p-nome" value="${esc(p.nome)}" autocomplete="name"></div>
      <div class="field"><label for="p-pombal">Nome do pombal</label><input class="input" id="p-pombal" value="${esc(p.nome_pombal)}"></div>
      <div class="field"><label for="p-cidade">Cidade, estado e país</label><input class="input" id="p-cidade" value="${esc(p.cidade)}" placeholder="Ex.: Campinas - SP - Brasil"></div>
      <div class="field"><label for="p-email">E-mail de contato</label><input class="input" id="p-email" type="email" value="${esc(p.email_contato)}"></div>
      <div class="field"><label for="p-tel">Telefone / WhatsApp</label><input class="input" id="p-tel" type="tel" value="${esc(p.telefone)}"></div>
      <button class="btn btn-primary btn-block" type="submit" ${state.ocupado ? 'disabled' : ''}>Salvar</button>
    </form>
    <p class="hint" style="text-align:center">Conectado como <b>${esc(email)}</b></p>
    <button class="btn btn-ghost btn-block" type="button" data-sair>Sair da conta</button>`);
}

// ---------- Render ----------
function render() {
  const app = $('#app');
  if (!state.pronto) { app.innerHTML = '<p class="carregando">Carregando…</p>'; return; }
  const logado = state.session && state.auth !== 'novaSenha';
  app.classList.toggle('sem-abas', !logado);
  if (!logado) { app.innerHTML = vAuth(); return; }
  const r = rotaAtual();
  app.innerHTML = r === 'conta' ? vConta() : r === 'pedigree' ? vPedigree() : vPlantel();
}

// ---------- Dados ----------
async function carregarPerfil() {
  state.perfilErro = null;
  if (!state.session) { state.perfil = null; return; }
  const { data, error } = await sb.from('perfis').select('*').eq('id', state.session.user.id).maybeSingle();
  if (error) {
    state.perfil = null;
    state.perfilErro = /perfis|relation|schema cache/i.test(error.message)
      ? 'O banco de dados ainda não foi preparado (falta rodar o SQL no Supabase).'
      : traduzir(error.message);
    return;
  }
  state.perfil = data;
}

// ---------- Eventos ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-auth],[data-sair]');
  if (!t) return;
  if (t.dataset.auth) { state.auth = t.dataset.auth; state.authMsg = null; render(); return; }
  if (t.hasAttribute('data-sair')) { await sb.auth.signOut(); state.auth = 'entrar'; history.replaceState(null, '', location.pathname); }
});

async function ocupar(fn) {
  state.ocupado = true; render();
  try { await fn(); } catch (err) { state.authMsg = { tipo: 'erro', texto: traduzir(err.message || err) }; }
  state.ocupado = false; render();
}

document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  const v = sel => { const el = $(sel); return el ? el.value.trim() : ''; };

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

window.addEventListener('hashchange', () => { if (state.pronto) { render(); window.scrollTo(0, 0); } });

sb.auth.onAuthStateChange((event, session) => {
  // Não chamar o Supabase direto aqui dentro (evita travar); agenda para depois.
  setTimeout(async () => {
    if (event === 'PASSWORD_RECOVERY') { state.auth = 'novaSenha'; state.authMsg = null; }
    const mudouUsuario = (state.session && state.session.user.id) !== (session && session.user.id);
    state.session = session;
    if (!state.pronto) return;
    if (mudouUsuario) await carregarPerfil();
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
})();
})();
