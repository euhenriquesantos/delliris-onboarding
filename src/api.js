/**
 * POST /onboarding/api
 *
 * Ponte entre o formulário e o Apps Script. Só chega aqui quem tem sessão
 * válida — quem confere isso é o roteador em index.js.
 *
 * Existe por um motivo de segurança: a URL do Apps Script e o segredo dele
 * ficam nos secrets da Cloudflare e nunca são entregues ao navegador. Sem esta
 * ponte, qualquer pessoa que abrisse o formulário poderia gravar direto no Drive.
 */

const ACOES = new Set(['iniciar', 'foto', 'pdf', 'ping']);
const LIMITE_CORPO = 8 * 1024 * 1024; // 8 MB — foto comprimida passa longe disso

const cabecalhos = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function erro(mensagem, status) {
  return new Response(JSON.stringify({ ok: false, erro: mensagem }), {
    status: status || 400, headers: cabecalhos
  });
}

export async function postApi(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, erro: 'Método não permitido.' }), {
      status: 405, headers: { ...cabecalhos, Allow: 'POST' }
    });
  }

  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SEGREDO) {
    return erro('Integração com o Drive não configurada. Avise quem administra o site.', 500);
  }

  const tamanho = Number(request.headers.get('Content-Length') || 0);
  if (tamanho > LIMITE_CORPO) {
    return erro('Arquivo grande demais para envio.', 413);
  }

  let corpo;
  try {
    const texto = await request.text();
    if (texto.length > LIMITE_CORPO) return erro('Arquivo grande demais para envio.', 413);
    corpo = JSON.parse(texto);
  } catch (_) {
    return erro('Requisição inválida.', 400);
  }

  if (!corpo || !ACOES.has(corpo.acao)) {
    return erro('Ação não permitida.', 400);
  }

  // O segredo é injetado aqui; o que vem do navegador é descartado.
  delete corpo.segredo;
  const carga = JSON.stringify({ ...corpo, segredo: env.APPS_SCRIPT_SEGREDO });

  let upstream;
  try {
    upstream = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: carga,
      redirect: 'follow'
    });
  } catch (e) {
    return erro('Não consegui falar com o Drive agora. Tente de novo em instantes.', 502);
  }

  const resposta = await upstream.text();
  try {
    JSON.parse(resposta);
  } catch (_) {
    // Apps Script devolvendo HTML costuma ser implantação errada ou sem autorização.
    return erro('O serviço do Drive respondeu de forma inesperada. Confira se a implantação do Apps Script está publicada na versão atual.', 502);
  }

  return new Response(resposta, { status: 200, headers: cabecalhos });
}
