/**
 * Dell'Iris — Roteiro de inauguração
 * Recebe o formulário de campo e organiza tudo no Drive.
 *
 * Estrutura criada dentro da pasta raiz:
 *   <Unidade>/
 *     2026-08-04 — Inauguração/
 *       relatorio-inauguracao-<unidade>-<data>.pdf
 *       Fotos/
 *         01-conhecer-a-operacao-01.jpg
 *         ...
 */

var PASTA_RAIZ_ID = '1cvRoef7v7e_yTWMQtB7f7F-m4nmrR_O_';

// Precisa ser igual ao secret APPS_SCRIPT_SEGREDO da Cloudflare.
// Só a ponte /api conhece este valor — ele nunca chega ao navegador.
var SEGREDO = 'TROQUE-PELO-SEGREDO-GERADO';

/* ------------------------------------------------------------------ */
/* Entradas                                                            */
/* ------------------------------------------------------------------ */

/**
 * Este Web App é só API — quem serve o formulário é a Cloudflare, atrás do
 * código de acesso. Se ele servisse a página, existiria uma cópia publica do
 * roteiro nesta URL, sem portão nenhum.
 */
function doGet() {
  return ContentService
    .createTextOutput('API do roteiro de inauguração. Use POST.')
    .setMimeType(ContentService.MimeType.TEXT);
}

/** Única entrada real: recebe as chamadas da ponte /api. */
function doPost(e) {
  var corpo;
  try {
    corpo = JSON.parse(e.postData.contents);
  } catch (err) {
    return responderJson({ ok: false, erro: 'Corpo da requisicao invalido' });
  }
  return responderJson(api(corpo));
}

/** Confere o segredo e despacha a ação. Nada roda antes dessa checagem. */
function api(req) {
  try {
    if (!req || req.segredo !== SEGREDO) {
      return { ok: false, erro: 'Nao autorizado' };
    }
    switch (req.acao) {
      case 'iniciar': return iniciar(req);
      case 'foto':    return salvarFoto(req);
      case 'pdf':     return salvarPdf(req);
      case 'ping':    return { ok: true, raiz: DriveApp.getFolderById(PASTA_RAIZ_ID).getName() };
      default:        return { ok: false, erro: 'Acao desconhecida: ' + req.acao };
    }
  } catch (err) {
    return { ok: false, erro: explicarErroDrive(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

/**
 * Cria (ou reaproveita) a pasta da unidade e a pasta da visita do dia.
 * Devolve os ids que as chamadas seguintes usam para gravar os arquivos.
 */
function iniciar(req) {
  var unidade = limparNome(req.unidade);
  if (!unidade) return { ok: false, erro: 'Unidade nao informada' };

  var data = /^\d{4}-\d{2}-\d{2}$/.test(req.data || '') ? req.data : formatarHoje();

  // Trava para duas pessoas enviando ao mesmo tempo não criarem pastas duplicadas.
  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  var pastaVisita, pastaFotos;
  try {
    var raiz = DriveApp.getFolderById(PASTA_RAIZ_ID);
    var pastaUnidade = pastaPorNome(raiz, unidade);
    pastaVisita = pastaPorNome(pastaUnidade, data + ' — Inauguração');
    pastaFotos = pastaPorNome(pastaVisita, 'Fotos');
  } finally {
    trava.releaseLock();
  }

  // Resumo em texto ao lado do PDF, útil para busca no Drive.
  var resumo = [
    'Unidade: ' + unidade,
    'Data: ' + data,
    'Responsável: ' + (req.responsavel || '(não informado)'),
    'Nota geral: ' + (req.nota === '' || req.nota == null ? '(não informada)' : req.nota + '/10'),
    'Fotos anexadas: ' + (req.totalFotos || 0),
    'Enviado em: ' + Utilities.formatDate(new Date(), fusoHorario(), 'dd/MM/yyyy HH:mm')
  ].join('\n');
  gravarUnico(pastaVisita, 'resumo.txt', Utilities.newBlob(resumo, 'text/plain', 'resumo.txt'));

  registrarNaPlanilha(unidade, data, req, pastaVisita.getUrl());

  return {
    ok: true,
    pastaVisitaId: pastaVisita.getId(),
    pastaFotosId: pastaFotos.getId(),
    pastaVisitaUrl: pastaVisita.getUrl()
  };
}

function salvarFoto(req) {
  var pasta = DriveApp.getFolderById(req.pastaFotosId);
  var blob = blobDeDataUrl(req.dataUrl, limparNome(req.nome) || 'foto.jpg');
  var arquivo = gravarUnico(pasta, blob.getName(), blob);
  return { ok: true, id: arquivo.getId() };
}

function salvarPdf(req) {
  var pasta = DriveApp.getFolderById(req.pastaVisitaId);
  var blob = blobDeDataUrl(req.dataUrl, limparNome(req.nome) || 'relatorio.pdf');
  var arquivo = gravarUnico(pasta, blob.getName(), blob);
  return { ok: true, id: arquivo.getId(), url: arquivo.getUrl() };
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

function pastaPorNome(pai, nome) {
  var existentes = pai.getFoldersByName(nome);
  return existentes.hasNext() ? existentes.next() : pai.createFolder(nome);
}

/** Grava o arquivo; se o nome já existir na pasta, sufixa com (2), (3)... */
function gravarUnico(pasta, nome, blob) {
  var nomeFinal = nome;
  var ponto = nome.lastIndexOf('.');
  var base = ponto > 0 ? nome.substring(0, ponto) : nome;
  var ext = ponto > 0 ? nome.substring(ponto) : '';
  var n = 2;
  while (pasta.getFilesByName(nomeFinal).hasNext()) {
    nomeFinal = base + ' (' + n + ')' + ext;
    n++;
  }
  blob.setName(nomeFinal);
  return pasta.createFile(blob);
}

function blobDeDataUrl(dataUrl, nome) {
  if (!dataUrl || dataUrl.indexOf('base64,') === -1) {
    throw new Error('Arquivo vazio ou em formato invalido');
  }
  var tipo = (dataUrl.match(/^data:([^;]+);/) || [])[1] || 'application/octet-stream';
  var dados = Utilities.base64Decode(dataUrl.substring(dataUrl.indexOf('base64,') + 7));
  return Utilities.newBlob(dados, tipo, nome);
}

/** Remove o que o Drive não aceita em nome de arquivo/pasta. */
function limparNome(texto) {
  return String(texto == null ? '' : texto)
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 120);
}

function fusoHorario() {
  return Session.getScriptTimeZone() || 'America/Sao_Paulo';
}

function formatarHoje() {
  return Utilities.formatDate(new Date(), fusoHorario(), 'yyyy-MM-dd');
}

/**
 * Opcional: espelha cada envio numa planilha de controle.
 * Deixe PLANILHA_ID em branco para desativar.
 */
var PLANILHA_ID = '';

function registrarNaPlanilha(unidade, data, req, url) {
  if (!PLANILHA_ID) return;
  try {
    var aba = SpreadsheetApp.openById(PLANILHA_ID).getSheets()[0];
    if (aba.getLastRow() === 0) {
      aba.appendRow(['Enviado em', 'Unidade', 'Data da visita', 'Responsável', 'Nota', 'Fotos', 'Pasta']);
    }
    aba.appendRow([
      new Date(), unidade, data,
      req.responsavel || '', req.nota || '', req.totalFotos || 0, url
    ]);
  } catch (err) {
    // Falha na planilha não pode derrubar o envio dos arquivos.
    console.warn('Nao consegui registrar na planilha: ' + err);
  }
}

function responderJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Rode uma vez pelo editor para autorizar e conferir o acesso à pasta raiz. */
function testarAcesso() {
  console.log('Conta que autorizou o script: ' + Session.getEffectiveUser().getEmail());
  var raiz = DriveApp.getFolderById(PASTA_RAIZ_ID);
  console.log('Pasta raiz OK: ' + raiz.getName() + ' — ' + raiz.getUrl());
  var teste = raiz.createFile(Utilities.newBlob('teste de escrita', 'text/plain', 'teste-delliris.txt'));
  console.log('Escrita OK. Removendo o arquivo de teste...');
  teste.setTrashed(true);
  console.log('Tudo certo: o script le e grava nessa pasta.');
}

/**
 * Chamado pelo app quando o DriveApp nega acesso, para o funcionario ver
 * uma instrucao util em vez de "Acesso negado: DriveApp".
 */
function explicarErroDrive(err) {
  var msg = String(err && err.message ? err.message : err);
  if (msg.indexOf('DriveApp') === -1 && msg.toLowerCase().indexOf('permission') === -1) return msg;
  return 'O script nao tem permissao no Drive. Quem administra deve abrir o projeto no Apps Script, ' +
         'rodar a funcao testarAcesso para reautorizar e publicar uma NOVA VERSAO da implantacao. ' +
         '(detalhe tecnico: ' + msg + ')';
}
