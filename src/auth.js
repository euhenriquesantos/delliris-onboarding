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
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#2b0000">
<meta name="robots" content="noindex, nofollow">
<title>Acesso — Dell'Iris</title>
<link rel="icon" href="/onboarding/img/logo.webp">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bordo: #630b0b; --dark: #2b0000; --green: #0c7b12;
    --white: #ffffff; --soft: rgba(255,255,255,.78); --mut: rgba(255,255,255,.55);
    --card-bg: rgba(43,0,0,.62); --card-border: rgba(255,255,255,.85);
    --erro: #ff9d9d; --radius: 16px; --pill: 42px;
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bordo); color: var(--white);
    margin: 0; min-height: 100vh; min-height: 100svh;
    display: flex; align-items: center; justify-content: center;
    padding: 24px; line-height: 1.55; -webkit-font-smoothing: antialiased;
    position: relative; overflow-x: hidden;
  }
  /* Profundidade só com o bordô da marca: a capa é o lockup, e ele tem
     tamanho de leitura próprio — recortá-lo como textura de fundo o tornava
     um borrão irreconhecível em tela de celular. */
  body::before {
    content: ""; position: fixed; inset: 0; z-index: 0;
    background:
      radial-gradient(120% 70% at 50% 0%, rgba(122,18,18,.95) 0%, rgba(99,11,11,1) 45%, rgba(43,0,0,1) 100%);
  }
  .painel { position: relative; z-index: 1; width: 100%; max-width: 380px; }
  .caixa {
    position: relative; z-index: 1;
    background: var(--card-bg); border: 2px solid var(--card-border);
    border-radius: var(--radius); padding: 32px 24px 26px;
    width: 100%; text-align: center;
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  }
  .capa {
    display: block; width: min(88%, 300px); height: auto;
    margin: 0 auto 18px; position: relative; z-index: 1;
  }
  h1 {
    font-family: "Roboto", sans-serif; font-weight: 400;
    font-size: 22px; line-height: 1.3; margin: 0 0 6px;
  }
  p.sub { font-size: 13.5px; color: var(--soft); margin: 0 0 22px; }
  input {
    width: 100%; padding: 15px; text-align: center;
    font-size: 28px; letter-spacing: 12px; text-indent: 12px;
    font-family: "Roboto", sans-serif; font-weight: 700;
    border: 2px solid rgba(255,255,255,.45); border-radius: 12px;
    background: rgba(255,255,255,.10); color: var(--white);
    -webkit-appearance: none;
  }
  input::placeholder { color: rgba(255,255,255,.3); letter-spacing: 8px; }
  input:focus { outline: none; border-color: var(--white); background: rgba(255,255,255,.16); }
  input.erro { border-color: var(--erro); }
  button {
    width: 100%; margin-top: 14px; padding: 15px;
    border: 2px solid var(--white); border-radius: var(--pill);
    background: var(--white); color: var(--bordo);
    font-family: inherit; font-size: 16px; font-weight: 700; cursor: pointer; transition: .18s;
  }
  button:hover:not(:disabled) { background: var(--green); border-color: var(--green); color: var(--white); }
  button:disabled { opacity: .45; cursor: default; }
  .msg { min-height: 22px; margin-top: 12px; font-size: 13.5px; color: var(--erro); }
  .rodape {
    position: relative; z-index: 1;
    margin-top: 18px; font-size: 11px; letter-spacing: 2px;
    text-transform: uppercase; color: var(--mut); text-align: center;
  }
</style>
</head>
<body>
  <div class="painel">
    <img class="capa" src="/onboarding/img/capa.png" alt="Dell'Iris — Comida que abraça!">
    <form class="caixa" id="form" autocomplete="off">
      <h1>Roteiro de inauguração</h1>
      <p class="sub">Digite o código de 6 dígitos para continuar.</p>
      <input id="codigo" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="••••••"
             maxlength="6" autocomplete="one-time-code" aria-label="Código de acesso" autofocus>
      <button type="submit" id="btn">Entrar</button>
      <div class="msg" id="msg" role="alert"></div>
    </form>
    <div class="rodape">Uso interno — Dell'Iris</div>
  </div>
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
