# Backend no Drive (Apps Script)

Navegador nenhum tem permissão para gravar no seu Drive. Quem grava é este **Google Apps Script**,
publicado como Web App e rodando com a sua conta.

Ele é **só API**: não serve página. Quem entrega o formulário é o Worker na Cloudflare, atrás do
código de acesso — veja o [README principal](../README.md).

## Passo a passo

1. Acesse [script.google.com](https://script.google.com) logado na conta **dona da pasta do Drive**
   e clique em **Novo projeto**. Nomeie como `Dell'Iris — Roteiro de inauguração`.

2. Apague o conteúdo do `Código.gs` e cole todo o conteúdo de `apps-script/Codigo.gs`.

3. **⚙️ Configurações do projeto → marque "Mostrar o arquivo de manifesto appsscript.json"** e
   substitua o conteúdo dele pelo de `apps-script/appsscript.json`.

4. Troque o `SEGREDO` no `Código.gs` por um valor aleatório longo (`openssl rand -base64 32`).
   Esse mesmo valor vai como secret `APPS_SCRIPT_SEGREDO` na Cloudflare. Ele nunca chega ao
   navegador: só a ponte `/onboarding/api` o conhece.

5. Confirme que **não existe** um arquivo `Index.html` no projeto. Se existir, apague — senão a
   URL do Apps Script serviria uma cópia pública do formulário, sem código de acesso.

6. Rode a função `testarAcesso` pelo editor (▶). O Google vai pedir autorização: **Revisar
   permissões → sua conta → Avançado → Acessar o projeto (não seguro) → Permitir**. Esse aviso é
   normal para script pessoal não verificado. O log deve terminar em
   *"Tudo certo: o script le e grava nessa pasta."*

7. **Implantar → Nova implantação → tipo: App da Web**
   - Executar como: **eu** (senão quem acessa precisaria de permissão de escrita no Drive)
   - Quem pode acessar: **Qualquer pessoa**
   - Copie a **URL do app da Web** — ela vira o secret `APPS_SCRIPT_URL` na Cloudflare.

"Qualquer pessoa" aqui não expõe nada: o endpoint só aceita POST com o `SEGREDO` correto, e esse
segredo existe apenas dentro da Cloudflare.

A ponte envia com `Content-Type: text/plain` de propósito — é o que evita o preflight de CORS que
o Apps Script não responde. Não troque para `application/json`.

## Erro "Specified permissions are not sufficient to call ..."

Ao declarar `oauthScopes` no manifesto, o script passa a ter **só** o que está naquela lista.
Se aparecer esse erro citando um escopo, acrescente o escopo citado ao `oauthScopes` do
`appsscript.json`, salve e rode a função de novo — o Google vai pedir a autorização atualizada.

Os três escopos do arquivo deste repositório cobrem tudo que o roteiro usa:
`drive` (criar pastas e arquivos), `spreadsheets` (a planilha de controle opcional) e
`userinfo.email` (o `testarAcesso` mostrar qual conta autorizou).

## Erro "Você não tem acesso à biblioteca 1bi7B..."

O projeto tem uma **biblioteca externa** declarada que o Google não consegue abrir (foi excluída,
ou é de outra conta). Com isso o script nem chega a rodar. Este roteiro **não usa biblioteca
nenhuma** — `DriveApp`, `HtmlService`, `LockService` e `Utilities` são nativos —, então a
referência pode sair sem medo.

Duas formas de remover, tanto faz:

- **Pela barra lateral:** no menu esquerdo, em **Bibliotecas**, clique no ▼ da biblioteca listada
  e escolha **Remover**.
- **Pelo manifesto:** abra o `appsscript.json` e apague o bloco `dependencies` inteiro, se existir:

  ```json
  "dependencies": {
    "libraries": [
      { "userSymbol": "...", "libraryId": "1bi7B1iq1pCg...", "version": "..." }
    ]
  }
  ```

O `appsscript.json` deste repositório já vem sem `dependencies` — se o erro apareceu depois de
você editar o manifesto, provavelmente o bloco antigo ficou no arquivo. O conteúdo final deve ser
exatamente igual ao de `apps-script/appsscript.json`, nada além disso.

Depois de remover: rode `testarAcesso` de novo e publique uma **nova versão** da implantação.

## Erro "Acesso negado: DriveApp"

O código rodou e o **Google** negou a permissão. Nunca é internet nem erro do formulário.
Faça na ordem — o passo 4 é obrigatório mesmo que os outros já estejam certos.

1. **Fixe os escopos no manifesto.** É a causa mais comum: o Google autorizou o script só com
   `drive.file` (acesso apenas a arquivos criados pelo próprio script), e sua pasta raiz não foi
   criada por ele. No editor, **⚙️ Configurações do projeto → marque "Mostrar o arquivo de
   manifesto appsscript.json"**. O arquivo aparece na lista; substitua o conteúdo dele pelo de
   `apps-script/appsscript.json`. O que resolve é o escopo `.../auth/drive` (amplo), no lugar do
   `drive.file`.

2. **Confira a conta.** Rode `testarAcesso` pelo editor. Ele agora imprime o e-mail que autorizou
   o script e tenta criar e apagar um arquivo de teste na pasta. Se o e-mail no log não for o dono
   da pasta — ou alguém com acesso de **Editor** nela —, saia das outras contas Google e refaça a
   autorização. Se o log terminar em "Tudo certo", o backend está funcionando.

3. **Reautorize.** Ao rodar `testarAcesso` depois de mexer no manifesto, o Google pede as
   permissões de novo (agora as mais amplas): **Revisar permissões → Avançado → Acessar o projeto →
   Permitir**. Se ele não pedir nada, revogue o acesso antigo em
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions) e rode de novo.

4. **Publique uma NOVA VERSÃO.** Escopo novo não vale para uma implantação já publicada — ela
   continua rodando com as permissões antigas. **Implantar → Gerenciar implantações → ✏️ →
   Versão: Nova versão → Implantar.** Pular isso é o motivo nº 1 de "consertei e continua dando erro".

5. **Cheque quem executa.** Na mesma tela, **Executar como** precisa ser **eu**. Se estiver
   "Usuário que acessa o app", o funcionário (que não tem permissão no Drive, e pode estar anônimo)
   é quem tenta gravar — e aí o acesso é negado sempre.

6. **A conta precisa poder gravar na pasta raiz.** Se o `testarAcesso` mostra o nome da pasta mas
   falha ao criar o arquivo de teste, é só permissão: ela lê, não escreve. Em pasta compartilhada
   com você, o papel precisa ser **Editor**; em Drive compartilhado, **Colaborador de conteúdo**.
   O caminho sem atrito é usar uma pasta que a própria conta do script **criou** — foi o que
   fizemos aqui.

Se a conta for do Google Workspace da empresa, vale conferir com o admin se a criação de arquivos
no Drive por apps não verificados está liberada.

## Sempre que mudar o código

**Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar.** Sem isso a URL
continua servindo a versão antiga.

## O que aparece no Drive

```
Pasta raiz (1cvRoef7v7e_yTWMQtB7f7F-m4nmrR_O_)/
└── Dell'Iris Londrina Centro/
    └── 2026-08-04 — Inauguração/
        ├── relatorio-inauguracao-delliris-londrina-centro-2026-08-04.pdf
        ├── resumo.txt
        └── Fotos/
            ├── 01-conhecer-a-operacao-01.jpg
            ├── 02-verificar-fluxo-de-trabalho-01.jpg
            └── ...
```

A pasta da unidade é reaproveitada nas visitas seguintes; cada visita ganha sua subpasta por data.
Dois envios no mesmo dia não se sobrescrevem — o segundo arquivo vira `... (2).pdf`.

## Controle em planilha (opcional)

Crie uma planilha, copie o id da URL e preencha `PLANILHA_ID` no `Código.gs`. Cada envio vira uma
linha com unidade, data, responsável, nota, nº de fotos e link da pasta.

## Detalhes que importam em campo

- As fotos são reduzidas para no máximo 1600px e comprimidas em JPEG **antes** de subir — uma foto
  de 4 MB vira ~250 KB. É o que faz o envio funcionar em 4G ruim.
- Cada foto sobe numa requisição separada, com barra de progresso. Se cair na foto 7 de 12, os
  dados continuam na tela e dá para reenviar (as já enviadas viram duplicatas `(2)`, então prefira
  limpar a pasta da visita antes de repetir).
- Textos e checkboxes ficam salvos no aparelho enquanto o formulário está aberto; as fotos **não**
  (não cabem no armazenamento local). Não feche a aba no meio do roteiro.
- **Baixar PDF no aparelho** é o plano B: sem internet, o funcionário salva o PDF e envia depois.
- A geração do PDF usa jsPDF via CDN, então a página precisa de internet para carregar.
