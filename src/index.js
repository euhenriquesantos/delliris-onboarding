/**
 * Roteiro de inauguração — Dell'Iris
 *
 * Worker que serve o formulário atrás de um código de acesso e faz a ponte
 * autenticada até o Apps Script, que grava no Drive.
 *
 * Regra que organiza o arquivo: nada sai daqui sem passar por `entregar()`,
 * e o formulário só é montado depois de `sessaoValida()`. Não há diretório de
 * arquivos estáticos — assets seriam públicos e passariam por cima do portão.
 */

import { sessaoValida, paginaLogin } from './auth.js';
import { postEntrar } from './entrar.js';
import { postApi } from './api.js';
import formulario from './formulario.html';

const PREFIXO = '/onboarding';

const CABECALHOS_SEGURANCA = {
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()'
};

/**
 * O formulário é todo inline (estilo e script na própria página) e busca o
 * jsPDF no cdnjs; as fotos viram data: URI. Daí a lista abaixo — é o mínimo
 * que a página precisa, e nada além disso é permitido.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ');

function entregar(resposta, html) {
  const r = new Response(resposta.body, resposta);
  for (const [chave, valor] of Object.entries(CABECALHOS_SEGURANCA)) {
    r.headers.set(chave, valor);
  }
  if (html) r.headers.set('Content-Security-Policy', CSP);
  return r;
}

function json(dados, status) {
  return new Response(JSON.stringify(dados), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function pagina(corpo, status) {
  return new Response(corpo, {
    status: status || 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const caminho = url.pathname.replace(/\/+$/, '') || '/';

    // Única rota que existe antes da sessão — senão não haveria como criá-la.
    if (caminho === PREFIXO + '/entrar') {
      return entregar(await postEntrar(request, env));
    }

    if (caminho === PREFIXO + '/api') {
      if (!(await sessaoValida(request, env))) {
        return entregar(json({
          ok: false,
          erro: 'Sessão expirada. Recarregue a página e digite o código de novo.'
        }, 401));
      }
      return entregar(await postApi(request, env));
    }

    if (caminho === PREFIXO) {
      if (!(await sessaoValida(request, env))) {
        return entregar(pagina(paginaLogin(), 401), true);
      }
      return entregar(pagina(formulario), true);
    }

    return entregar(pagina('Não encontrado.', 404));
  }
};
