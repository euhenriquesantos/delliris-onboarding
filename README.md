# Roteiro de inauguração — Dell'Iris

Formulário de campo para a vistoria de inauguração de unidades. O funcionário abre
`delliris.com.br/onboarding`, digita o código de acesso, preenche o roteiro, tira as fotos e
envia. O relatório em PDF e as fotos aparecem organizados no Google Drive.

## Como funciona

```
Funcionário
    │  delliris.com.br/onboarding  + código de 6 dígitos
    ▼
Cloudflare Worker
    ├── src/index.js        roteia e aplica o portão: sem sessão, nada é entregue
    ├── src/entrar.js       confere o código, abre a sessão
    ├── src/api.js          ponte autenticada (guarda os segredos)
    ├── src/auth.js         assinatura da sessão, tela de código, limite de tentativas
    └── src/formulario.html o formulário, embutido no Worker (não é arquivo público)
    │
    ▼  POST com o segredo injetado no servidor
Google Apps Script  (apps-script/Codigo.gs)
    │
    ▼
Google Drive — pasta "Vistoria de Campo"
    └── <Unidade>/<data> — Inauguração/
        ├── relatorio-inauguracao-<unidade>-<data>.pdf
        ├── resumo.txt
        └── Fotos/01-conhecer-a-operacao-01.jpg ...
```

O PDF é gerado no próprio celular (jsPDF) e as fotos são reduzidas para 1600px e comprimidas
antes de subir — uma foto de 4 MB vira ~250 KB, que é o que faz o envio funcionar em 4G de loja.
Cada foto sobe numa requisição separada, com barra de progresso.

## Identidade visual

Mesma linguagem da Central de Documentos: bordô `#630b0b` de fundo, `#2b0000` na barra
superior, cartões `rgba(43,0,0,.49)` com borda branca de 2px e raio 16px, botões em pílula
branca que viram verde `#0c7b12` no hover, Roboto nos títulos e Open Sans no corpo.

Duas adaptações conscientes, porque aqui o contexto é diferente de um site institucional:

- **Campos de formulário são brancos com texto escuro.** O roteiro é preenchido em pé, dentro
  de loja, muitas vezes sob luz forte — contraste alto vale mais que fidelidade cromática.
- **Verde clareado (`#4fc25c`) para texto de sucesso e barras de progresso.** O `#0c7b12` da
  marca não tem contraste suficiente sobre o bordô; ele segue sendo usado nos hovers, onde o
  fundo é branco.

As imagens ficam em `src/img/`, já otimizadas, e são servidas pelo próprio Worker em
`/onboarding/img/*` com cache de um ano. A `capa.jpg` saiu de 488 KB para 119 KB — ela aparece
sob um véu bordô na tela de código, então perda de qualidade ali é invisível e o carregamento
em 4G é o que importa. O logo do PDF vai embutido em base64 no HTML, porque o relatório é
gerado no aparelho e não pode depender de baixar nada na hora.

## Decisões de segurança

| O que | Como | Por quê |
|---|---|---|
| Código de acesso | Secret `CODIGO_ACESSO` na Cloudflare, conferido **no servidor** | Código dentro do HTML é lido por qualquer um no "ver código-fonte" |
| Sessão | Cookie assinado com HMAC-SHA256, `HttpOnly` + `Secure` + `SameSite=Strict`, validade de 12h | Não dá para forjar sem a chave; XSS não consegue ler o cookie |
| Força bruta | Máx. 8 tentativas por IP a cada 15 min (KV `TENTATIVAS`) | 6 dígitos são só 1 milhão de combinações |
| Comparações | Tempo constante (`iguaisEmTempoConstante`) | Não vaza quantos dígitos acertou pelo tempo de resposta |
| Segredo do Drive | Secrets `APPS_SCRIPT_URL` / `APPS_SCRIPT_SEGREDO`, usados só na ponte | O navegador nunca vê a URL nem o segredo — sem isso, quem abrisse a página poderia gravar direto no Drive |
| Apps Script | Web App é **só API** (`doGet` não serve página) | Se servisse, existiria uma cópia pública do formulário sem portão |
| Formulário | Importado como módulo de texto pelo Worker; **não existe diretório de static assets** | Assets são servidos antes do código rodar. Com eles, o portão dependeria da flag `run_worker_first` — e se ela falhasse, o vazamento seria silencioso |
| Cabeçalhos | CSP restritiva, `noindex`, `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy` | Fora de buscador, fora de iframe, e a página só carrega o que precisa |

**O limite honesto disto:** um código único de 6 dígitos, compartilhado entre pessoas, é
*controle de acesso*, não autenticação. Ele não distingue quem entrou, não é revogável por
pessoa e, se vazar num grupo de WhatsApp, vale para todo mundo. O limite por IP encarece muito
a força bruta, mas não a torna impossível para quem tenha muitos IPs. Se em algum momento isso
proteger dado sensível de cliente, o caminho é **Cloudflare Access** (Zero Trust, gratuito até
50 usuários): login por e-mail com código, por pessoa, revogável, e sem código compartilhado.
Dá para ligar por cima desta mesma estrutura, sem reescrever nada.

## Publicar

### 1. Backend no Drive (Apps Script)

Veja [apps-script/README.md](apps-script/README.md). Ao final você tem uma URL `.../exec` e um
valor de `SEGREDO` — os dois viram secrets no passo 3.

Se o projeto ainda tiver um arquivo `Index.html`, **apague-o** e publique nova versão: o Web App
não deve mais servir página nenhuma.

### 2. KV para o limite de tentativas

**Workers & Pages → KV → Create a namespace**, nome `tentativas-acesso`. Copie o **ID** que
aparece e cole em `wrangler.jsonc`, no lugar de `COLE_AQUI_O_ID_DO_NAMESPACE_KV`. Commit e push.

O ID não é segredo — é só um identificador. Ele precisa estar no arquivo porque, em Workers, os
bindings vêm da configuração versionada: um binding criado só pelo painel é apagado no deploy
seguinte.

> Sem esse binding o site **nega todos os acessos**, de propósito: é melhor falhar visível do que
> rodar sem proteção contra força bruta.

### 3. Worker no Cloudflare

**Workers & Pages → Create → Import a repository** e escolha `delliris-onboarding`.
Deploy command: `npx wrangler deploy` (é o padrão). Build command fica vazio — não há build.

Se o build reclamar de *"repository that no longer exists"*, o GitHub App da Cloudflare perdeu
acesso ao repositório (acontece ao torná-lo privado): [github.com/settings/installations](https://github.com/settings/installations)
→ Cloudflare → Configure → adicione `delliris-onboarding` em Repository access.

Depois do primeiro deploy, em **Settings → Variables and Secrets**, adicione como **Secret**
(o tipo importa — "Text" é visível no painel e some no deploy seguinte):

| Nome | Valor |
|---|---|
| `CODIGO_ACESSO` | o código de 6 dígitos |
| `SESSAO_SEGREDO` | 64 caracteres aleatórios (`openssl rand -hex 32`) |
| `APPS_SCRIPT_URL` | a URL `.../exec` do passo 1 |
| `APPS_SCRIPT_SEGREDO` | o mesmo `SEGREDO` do `Codigo.gs` |

Secrets sobrevivem aos deploys seguintes; não precisam estar no `wrangler.jsonc` e **não devem**.

A tela de secrets só aparece depois que existe código no Worker: um Worker apenas com arquivos
estáticos mostra *"Variables cannot be added to a Worker that only has static assets"*. Aqui não
acontece, porque o `wrangler.jsonc` aponta um `main`.

Refaça o deploy depois de cadastrar tudo.

### 4. Domínio

**Custom domains → Set up a domain → `delliris.com.br`**. Como o domínio já usa nameservers da
Cloudflare, o registro é criado sozinho. O formulário fica em `delliris.com.br/onboarding`.

Em **Settings → Domains & Routes → Add → Custom domain**, use `delliris.com.br`. O Worker responde
em `/onboarding`; qualquer outro caminho devolve 404, então o domínio fica livre para um site
principal no futuro (aí a rota vira `delliris.com.br/onboarding*`).

## Rodar localmente

```bash
cp .dev.vars.example .dev.vars   # preencha; o .dev.vars nunca é versionado
npx wrangler dev                 # abre em http://localhost:8787/onboarding
```

Conferir o empacotamento sem publicar nada:

```bash
npx wrangler deploy --dry-run
```

## Trocar o código de acesso

Painel da Cloudflare → Settings → Variables and Secrets → editar `CODIGO_ACESSO`. Não mexe em
código e não precisa de commit. As sessões já abertas continuam válidas até expirar; para cortar
todas na hora, troque também o `SESSAO_SEGREDO`.
