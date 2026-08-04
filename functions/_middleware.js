/**
 * Portão de acesso de /onboarding.
 *
 * Nada abaixo de /onboarding é entregue sem uma sessão válida — nem o HTML do
 * formulário, nem as chamadas de API. O código de acesso vive só como secret na
 * Cloudflare; ele nunca chega ao navegador e nunca entra no repositório.
 */

import { sessaoValida, paginaLogin } from './_lib/auth.js';

const PREFIXO = '/onboarding';

// Rotas que precisam existir antes da sessão (senão não há como criar sessão).
const PUBLICAS = new Set([PREFIXO + '/entrar']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const caminho = url.pathname.replace(/\/+$/, '') || '/';

  // Fora de /onboarding o middleware não se mete.
  if (caminho !== PREFIXO && !caminho.startsWith(PREFIXO + '/')) {
    return next();
  }

  // Todo o site é HTTPS-only e nunca deve ser indexado ou embutido em iframe.
  const responder = (resposta) => {
    const r = new Response(resposta.body, resposta);
    r.headers.set('X-Robots-Tag', 'noindex, nofollow');
    r.headers.set('X-Content-Type-Options', 'nosniff');
    r.headers.set('X-Frame-Options', 'DENY');
    r.headers.set('Referrer-Policy', 'no-referrer');
    r.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    r.headers.set('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
    return r;
  };

  if (PUBLICAS.has(caminho)) return responder(await next());

  if (await sessaoValida(request, env)) return responder(await next());

  // Sem sessão: API responde 401 em JSON, navegação recebe a tela de código.
  if (caminho.startsWith(PREFIXO + '/api')) {
    return responder(new Response(
      JSON.stringify({ ok: false, erro: 'Sessão expirada. Recarregue a página e digite o código de novo.' }),
      { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    ));
  }

  return responder(new Response(paginaLogin(), {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  }));
}
