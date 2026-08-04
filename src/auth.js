/**
 * Sessão assinada e tela de código.
 *
 * O cookie não guarda o código de acesso — guarda só validade + um id aleatório,
 * assinado com HMAC-SHA256. Sem a chave SESSAO_SEGREDO não dá para forjar um
 * cookie válido, e o cookie roubado expira sozinho.
 */

const NOME_COOKIE = 'dio_sessao';
const CAMINHO_COOKIE = '/onboarding';
const HORAS_PADRAO = 12;

const enc = new TextEncoder();

/* ------------------------------------------------------------------ */
/* Assinatura                                                          */
/* ------------------------------------------------------------------ */

function b64url(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deB64url(texto) {
  const s = texto.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function chave(segredo) {
  return crypto.subtle.importKey(
    'raw', enc.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

async function assinar(dados, segredo) {
  return b64url(await crypto.subtle.sign('HMAC', await chave(segredo), enc.encode(dados)));
}

/** Comparação em tempo constante: não vaza quantos caracteres bateram. */
function iguaisEmTempoConstante(a, b) {
  const ba = enc.encode(String(a));
  const bb = enc.encode(String(b));
  // O tamanho ainda difere em tempo; por isso o segredo tem tamanho fixo conhecido.
  let diff = ba.length ^ bb.length;
  const n = Math.max(ba.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ba[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Sessão                                                              */
/* ------------------------------------------------------------------ */

export async function criarCookieSessao(env) {
  const horas = Number(env.SESSAO_HORAS || HORAS_PADRAO);
  const carga = JSON.stringify({
    exp: Date.now() + horas * 3600 * 1000,
    jti: b64url(crypto.getRandomValues(new Uint8Array(12)))
  });
  const corpo = b64url(enc.encode(carga));
  const token = corpo + '.' + await assinar(corpo, env.SESSAO_SEGREDO);

  return [
    NOME_COOKIE + '=' + token,
    'Path=' + CAMINHO_COOKIE,
    'Max-Age=' + Math.floor(horas * 3600),
    'HttpOnly',            // JS da página não lê o cookie: XSS não rouba a sessão
    'Secure',              // só trafega em HTTPS
    'SameSite=Strict'      // não acompanha requisição vinda de outro site
  ].join('; ');
}

export function cookieExpirado() {
  return NOME_COOKIE + '=; Path=' + CAMINHO_COOKIE + '; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
}

export async function sessaoValida(request, env) {
  if (!env.SESSAO_SEGREDO) return false;

  const cabecalho = request.headers.get('Cookie') || '';
  const achado = cabecalho.split(';')
    .map(p => p.trim())
    .find(p => p.startsWith(NOME_COOKIE + '='));
  if (!achado) return false;

  const token = achado.slice(NOME_COOKIE.length + 1);
  const corte = token.lastIndexOf('.');
  if (corte < 1) return false;

  const corpo = token.slice(0, corte);
  const assinaturaRecebida = token.slice(corte + 1);

  const esperada = await assinar(corpo, env.SESSAO_SEGREDO);
  if (!iguaisEmTempoConstante(assinaturaRecebida, esperada)) return false;

  try {
    const carga = JSON.parse(new TextDecoder().decode(deB64url(corpo)));
    return typeof carga.exp === 'number' && carga.exp > Date.now();
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Código de acesso                                                    */
/* ------------------------------------------------------------------ */

export function codigoConfere(informado, env) {
  const correto = String(env.CODIGO_ACESSO || '');
  if (!correto) return false;
  return iguaisEmTempoConstante(String(informado || '').trim(), correto);
}

/**
 * Limite de tentativas por IP. Sem isso, 6 dígitos (1 milhão de combinações)
 * caem em força bruta. Exige o KV TENTATIVAS: se faltar, o acesso é negado —
 * é de propósito, para não rodar sem proteção sem ninguém perceber.
 */
export async function registrarTentativa(request, env) {
  const kv = env.TENTATIVAS;
  if (!kv) {
    return { permitido: false, erro: 'Proteção contra tentativas não configurada (falta o KV "TENTATIVAS"). Avise quem administra o site.' };
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'desconhecido';
  const janelaSegundos = Number(env.JANELA_SEGUNDOS || 900);   // 15 min
  const maxTentativas = Number(env.MAX_TENTATIVAS || 8);

  const chaveIp = 'ip:' + ip;
  const atual = Number(await kv.get(chaveIp)) || 0;

  if (atual >= maxTentativas) {
    return {
      permitido: false,
      esperar: janelaSegundos,
      erro: 'Muitas tentativas. Espere ' + Math.ceil(janelaSegundos / 60) + ' minutos e tente de novo.'
    };
  }

  await kv.put(chaveIp, String(atual + 1), { expirationTtl: janelaSegundos });
  return { permitido: true, restantes: maxTentativas - atual - 1, chaveIp: chaveIp };
}

export async function limparTentativas(env, chaveIp) {
  if (env.TENTATIVAS && chaveIp) {
    try { await env.TENTATIVAS.delete(chaveIp); } catch (_) {}
  }
}

/* ------------------------------------------------------------------ */
/* Tela de código                                                      */
/* ------------------------------------------------------------------ */

export function paginaLogin() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Acesso — Dell'Iris</title>
<style>
  :root {
    --surface-0: #f7f6f2; --surface-2: #ffffff;
    --text-primary: #1c1c1a; --text-secondary: #5f5e5a;
    --text-danger: #a32d2d; --border: #d3d1c7; --border-strong: #b4b2a9;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--surface-0); color: var(--text-primary);
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 1.5rem; line-height: 1.6;
  }
  .caixa {
    background: var(--surface-2); border: 0.5px solid var(--border);
    border-radius: 12px; padding: 2rem 1.5rem; width: 100%; max-width: 360px; text-align: center;
  }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p.sub { font-size: 13px; color: var(--text-secondary); margin: 0 0 1.5rem; }
  input {
    width: 100%; padding: 14px; text-align: center;
    font-size: 26px; letter-spacing: 10px; font-family: inherit; font-weight: 600;
    border: 0.5px solid var(--border-strong); border-radius: 8px;
    background: var(--surface-0); color: var(--text-primary);
  }
  input:focus { outline: 2px solid var(--text-primary); outline-offset: 1px; }
  input.erro { border-color: var(--text-danger); }
  button {
    width: 100%; margin-top: 12px; padding: 12px; border: none; border-radius: 8px;
    background: #1c1c1a; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: default; }
  .msg { min-height: 20px; margin-top: 10px; font-size: 13px; color: var(--text-danger); }
</style>
</head>
<body>
  <form class="caixa" id="form" autocomplete="off">
    <h1>Roteiro de inauguração</h1>
    <p class="sub">Digite o código de 6 dígitos para continuar.</p>
    <input id="codigo" type="password" inputmode="numeric" pattern="[0-9]*"
           maxlength="6" autocomplete="one-time-code" aria-label="Código de acesso" autofocus>
    <button type="submit" id="btn">Entrar</button>
    <div class="msg" id="msg" role="alert"></div>
  </form>
<script>
  const form = document.getElementById('form');
  const campo = document.getElementById('codigo');
  const btn = document.getElementById('btn');
  const msg = document.getElementById('msg');

  campo.addEventListener('input', () => {
    campo.value = campo.value.replace(/\\D/g, '').slice(0, 6);
    campo.classList.remove('erro');
    msg.textContent = '';
    if (campo.value.length === 6) form.requestSubmit();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (campo.value.length !== 6) { msg.textContent = 'O código tem 6 dígitos.'; return; }
    btn.disabled = true; msg.textContent = 'Verificando...';
    try {
      const r = await fetch('/onboarding/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: campo.value })
      });
      const dados = await r.json();
      if (dados.ok) { location.replace('/onboarding/'); return; }
      campo.classList.add('erro');
      campo.value = '';
      msg.textContent = dados.erro || 'Código incorreto.';
    } catch (_) {
      msg.textContent = 'Falha de conexão. Tente de novo.';
    }
    btn.disabled = false;
    campo.focus();
  });
</script>
</body>
</html>`;
}
