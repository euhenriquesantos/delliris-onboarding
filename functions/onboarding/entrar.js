/**
 * POST /onboarding/entrar  { codigo: "123456" }
 *
 * Única porta de entrada. Confere o código contra o secret CODIGO_ACESSO,
 * com limite de tentativas por IP e comparação em tempo constante.
 */

import {
  codigoConfere, criarCookieSessao,
  registrarTentativa, limparTentativas
} from '../_lib/auth.js';

const cabecalhos = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function resposta(dados, status, cookie) {
  const h = new Headers(cabecalhos);
  if (cookie) h.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(dados), { status: status || 200, headers: h });
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, erro: 'Método não permitido.' }), {
      status: 405, headers: { ...cabecalhos, Allow: 'POST' }
    });
  }

  if (!env.SESSAO_SEGREDO || !env.CODIGO_ACESSO) {
    return resposta({ ok: false, erro: 'Site sem configuração de acesso. Avise quem administra.' }, 500);
  }

  const limite = await registrarTentativa(request, env);
  if (!limite.permitido) {
    return resposta({ ok: false, erro: limite.erro }, limite.esperar ? 429 : 500);
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (_) {
    return resposta({ ok: false, erro: 'Requisição inválida.' }, 400);
  }

  const codigo = String(corpo && corpo.codigo || '');
  if (!/^\d{6}$/.test(codigo)) {
    return resposta({ ok: false, erro: 'O código tem 6 dígitos.' }, 400);
  }

  if (!codigoConfere(codigo, env)) {
    // Atraso pequeno e uniforme: encarece a força bruta sem travar quem errou de verdade.
    await new Promise(r => setTimeout(r, 400));
    const restantes = limite.restantes;
    return resposta({
      ok: false,
      erro: restantes > 0
        ? 'Código incorreto. Restam ' + restantes + ' tentativa(s).'
        : 'Código incorreto. Esta foi a última tentativa.'
    }, 401);
  }

  // Acertou: zera o contador do IP e abre a sessão.
  await limparTentativas(env, limite.chaveIp);
  return resposta({ ok: true }, 200, await criarCookieSessao(env));
}
