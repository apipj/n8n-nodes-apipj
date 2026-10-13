# n8n-nodes-apipj: consultar CNPJ no n8n (API CNPJ gratuita)

[![npm](https://img.shields.io/npm/v/n8n-nodes-apipj.svg)](https://www.npmjs.com/package/n8n-nodes-apipj)
[![licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE.md)

[English version below](#english)

Community node do [n8n](https://n8n.io) para **consultar CNPJ** com a [apipj](https://apipj.com.br), uma **API CNPJ gratuita**
com os dados abertos da Receita Federal: razão social, nome fantasia, situação cadastral, endereço (com código IBGE do
município), CNAE principal e secundários, sócios (QSA), Simples Nacional e MEI. Também valida CNPJ numérico e
**CNPJ alfanumérico** (IN RFB 2.229/2024) e funciona como ferramenta de **AI Agent**.

- Plano grátis: 50.000 consultas por mês, sem cartão. [Crie sua conta](https://apipj.com.br/criar-conta).
- Validar CNPJ e consultar o status da base não precisam de chave e não gastam cota.
- Sem dependências em tempo de execução.

> A interface do node está em inglês (exigência do n8n para nodes verificados). Abaixo, os nomes aparecem exatamente
> como você vai vê-los no n8n.

## Instalação

### n8n self-hosted (pela interface)

1. Abra **Settings > Community Nodes**.
2. Clique em **Install**.
3. Digite `n8n-nodes-apipj`, marque a confirmação de risco e clique em **Install**.

O node aparece no painel como **apipj (CNPJ)** (busque por "CNPJ" ou "apipj"). Veja também a
[documentação do n8n sobre community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

### Instalação manual (Docker, modo fila ou sem acesso à interface)

```bash
# dentro do container ou servidor do n8n
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install n8n-nodes-apipj
# reinicie o n8n
```

> No n8n Cloud só aparecem community nodes verificados pelo n8n.

## Credencial

1. Crie uma conta grátis em <https://apipj.com.br/criar-conta> e copie a chave de API no painel (começa com `apipj_live_`).
2. No n8n, crie uma credencial **Apipj API** e cole a chave no campo **API Key**.
3. Clique em **Save**: o n8n testa a chave com uma consulta ao CNPJ 00.000.000/0001-91 (gasta 1 consulta da cota).

A chave só é exigida pela operação **Look Up CNPJ**. **Validate CNPJ** e **Get Dataset Status** funcionam sem credencial.

## Operações

| Operação no n8n | O que faz | Endpoint | Chave | Gasta cota |
| --- | --- | --- | --- | --- |
| **Look Up CNPJ** | Consulta o cadastro completo da empresa | `GET /v1/cnpj/{cnpj}` | sim | sim |
| **Validate CNPJ** | Valida formato e dígitos verificadores: `{ cnpj, valido, formatado, alfanumerico, erro }` | `GET /v1/valida/{cnpj}` | não | não |
| **Get Dataset Status** | Mês de referência e tamanho da base: `{ status, dataset_month, rows, ... }` | `GET /v1/status` | não | não |

O campo **CNPJ** aceita o número com ou sem máscara (`00.000.000/0001-91` ou `00000000000191`) e o CNPJ alfanumérico
(`12.ABC.345/01DE-35`). Tudo que não for letra ou número é removido e as letras viram maiúsculas. Se uma expressão
devolver um número (por exemplo uma coluna de planilha que perdeu os zeros à esquerda), o node completa com zeros até
14 dígitos.

Os dados devolvidos são o JSON da API, com os nomes de campo em português (`razao_social`, `situacao_cadastral`...).

### Opções de Look Up CNPJ

- **Format**
  - **Full** (padrão): documento estruturado, com `razao_social`, `nome_fantasia`,
    `situacao_cadastral { codigo, descricao, data, motivo }`, `endereco { ..., municipio { codigo_ibge, nome } }`,
    `cnae_principal`, `cnaes_secundarios`, `socios`, `simples` e mais.
  - **Simplified**: formato plano, com datas `DD/MM/AAAA` e CNPJ, CEP e telefone já formatados
    (`nome`, `fantasia`, `situacao`, `atividade_principal`, `qsa`...).
- **Continue If Not Found**
  - Desligado (padrão): o item falha se o CNPJ é válido mas não está na base da Receita Federal.
  - Ligado: devolve `{ "cnpj": "...", "found": false }` e segue o workflow. Use um node **If** com
    `{{ $json.found === false }}` para separar esses casos.

Antes de chamar a API, o node confere os dígitos verificadores: um CNPJ inválido falha na hora e não gasta consulta.

### Exemplos de expressões

```text
{{ $json.razao_social }}
{{ $json.situacao_cadastral.descricao }}          // ATIVA, BAIXADA, INAPTA...
{{ $json.endereco.municipio.codigo_ibge }}
{{ $json.cnae_principal.codigo }}
{{ $json.socios.map(s => s.nome).join(', ') }}
```

## Exemplo de workflow

O arquivo [`examples/lookup-cnpj.json`](examples/lookup-cnpj.json) tem o fluxo
**When clicking Execute workflow > Validate CNPJ > Look Up CNPJ**. Para usar: copie o conteúdo do arquivo, cole no
editor do n8n (Ctrl+V) e escolha a sua credencial **Apipj API** no node **Look Up CNPJ**.

Saída resumida de **Look Up CNPJ** para `00.000.000/0001-91`:

```json
{
  "cnpj": "00000000000191",
  "cnpj_formatado": "00.000.000/0001-91",
  "razao_social": "BANCO DO BRASIL SA",
  "nome_fantasia": "DIRECAO GERAL",
  "situacao_cadastral": { "codigo": "02", "descricao": "ATIVA", "data": "2005-11-03" },
  "cnae_principal": { "codigo": "6422100", "descricao": "Bancos múltiplos, com carteira comercial" },
  "endereco": { "bairro": "ASA NORTE", "cep": "70040912", "municipio": { "codigo_ibge": "5300108", "nome": "BRASILIA" }, "uf": "DF" }
}
```

Para enriquecer uma lista (planilha, CRM, formulário), ligue a fonte de dados ao node **Look Up CNPJ** com
`{{ $json.cnpj }}` no campo **CNPJ**: o node faz uma consulta por item.

## Uso com AI Agent

O node tem `usableAsTool`, então pode ser ligado como ferramenta de um **AI Agent**. Deixe o campo **CNPJ** como
`{{ $fromAI('cnpj', 'CNPJ da empresa, com ou sem máscara') }}` para o modelo preencher. Em versões antigas do n8n
self-hosted, pode ser preciso definir `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` para usar community nodes como
ferramenta.

## Limites e planos

| Plano | Preço | Consultas por minuto | Consultas por mês |
| --- | --- | --- | --- |
| Grátis | R$ 0 | 10 | 50.000 |
| Dev | R$ 12,90/mês | 30 | 200.000 |
| Pro | R$ 59,90/mês | 200 | 600.000 |

- Assinar: [Dev](https://apipj.com.br/painel?assinar=dev) · [Pro](https://apipj.com.br/painel?assinar=pro) ·
  [criar conta grátis](https://apipj.com.br/criar-conta)
- **Limite por minuto** (HTTP 429 `rate_limited`): o node espera o tempo do cabeçalho `Retry-After` e tenta de novo,
  até 3 vezes. Para listas grandes no plano grátis, use **Loop Over Items** com lotes de 10 e um **Wait** de 60 segundos.
- **Cota mensal esgotada** (HTTP 429 `quota_exceeded`): o node para com uma mensagem e o link para assinar um plano
  maior. Não há nova tentativa.
- Instabilidade da API (5xx) ou de rede: até 3 novas tentativas, com espera de 1 s, 2 s e 4 s.
- **On Error > Continue** (nas Settings do node) é suportado: o item com problema sai como `{ "error": "..." }` e os
  outros seguem.

## Mensagens comuns

| Mensagem no n8n | O que fazer |
| --- | --- |
| The apipj API key was rejected | Confira a chave na credencial **Apipj API**. |
| The value of the 'CNPJ' field is not a valid CNPJ | Confira os 14 caracteres e os dígitos verificadores. Nenhuma consulta foi gasta. |
| CNPJ ... is not in the Receita Federal dataset | CNPJ válido mas inexistente. Ligue **Continue If Not Found** para seguir o fluxo. |
| The monthly lookup quota of your apipj plan is used up | Assine o plano Dev ou Pro, ou espere a virada do mês. |
| The per-minute rate limit of your apipj plan was reached | Reduza o ritmo (Loop Over Items + Wait) ou assine um plano maior. |

## Compatibilidade

Testado com n8n 2.43.4 (imagem Docker `n8nio/n8n`).

## Desenvolvimento

```bash
npm install
npm run lint
npm run build
npm test                                               # testes com respostas simuladas
APIPJ_TESTE_REAL=1 APIPJ_KEY=apipj_live_... npm test   # inclui chamadas reais à API
npm run dev                                            # sobe um n8n local com o node
```

A publicação no npm é feita pelo GitHub Actions ([`publish.yml`](.github/workflows/publish.yml)) ao enviar uma tag
`v*`, com provenance.

## Links

- Site e documentação da API: <https://apipj.com.br> · <https://apipj.com.br/docs>
- Cliente oficial JavaScript: [apipj-js](https://github.com/apipj/apipj-js)
- Problemas e sugestões: [issues](https://github.com/apipj/n8n-nodes-apipj/issues)

## Licença

[MIT](LICENSE.md)

---

## English

**n8n-nodes-apipj** is an [n8n](https://n8n.io) community node for [apipj](https://apipj.com.br), a free API to look
up Brazilian companies by **CNPJ** (the Brazilian company registration number), backed by Receita Federal (Brazilian
federal revenue service) open data: legal name, trade name, registration status, address (with IBGE city code), main
and secondary activity codes (CNAE), partners, Simples Nacional and MEI tax regimes. It also validates numeric and
**alphanumeric CNPJs** (IN RFB 2.229/2024) and can be used as an **AI Agent tool**.

- Free plan: 50,000 lookups per month, no credit card. [Create an account](https://apipj.com.br/criar-conta).
- Validate CNPJ and Get Dataset Status need no API key and use no quota.
- No runtime dependencies.

### Installation

**Self-hosted n8n (UI):**

1. Go to **Settings > Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-apipj`, acknowledge the risk notice and select **Install**.

The node shows up in the nodes panel as **apipj (CNPJ)** (search for "CNPJ" or "apipj"). See the
[n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

**Manual installation (Docker, queue mode or no UI access):**

```bash
# inside the n8n container or server
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install n8n-nodes-apipj
# restart n8n
```

On n8n Cloud, only community nodes verified by n8n are available.

### Credentials

1. Create a free account at <https://apipj.com.br/criar-conta> and copy your API key from the dashboard (it starts
   with `apipj_live_`).
2. In n8n, create an **Apipj API** credential and paste the key into **API Key**.
3. Select **Save**: n8n tests the key by looking up CNPJ 00.000.000/0001-91 (uses 1 lookup from your quota).

Only **Look Up CNPJ** needs the credential. **Validate CNPJ** and **Get Dataset Status** work without one.

### Operations

| Operation | What it does | Endpoint | API key | Uses quota |
| --- | --- | --- | --- | --- |
| **Look Up CNPJ** | Returns the company's full registration record | `GET /v1/cnpj/{cnpj}` | yes | yes |
| **Validate CNPJ** | Checks format and check digits: `{ cnpj, valido, formatado, alfanumerico, erro }` | `GET /v1/valida/{cnpj}` | no | no |
| **Get Dataset Status** | Reference month and size of the dataset: `{ status, dataset_month, rows, ... }` | `GET /v1/status` | no | no |

The **CNPJ** field accepts the number with or without punctuation (`00.000.000/0001-91` or `00000000000191`) and
alphanumeric CNPJs (`12.ABC.345/01DE-35`). Anything that is not a letter or digit is removed and letters are
uppercased. If an expression returns a number (e.g. a spreadsheet column that lost its leading zeros), the node
left-pads it with zeros to 14 digits. The output is the API's JSON as-is, so field names are in Portuguese
(`razao_social` = legal name, `nome_fantasia` = trade name, `situacao_cadastral` = registration status,
`endereco` = address, `socios` = partners).

**Look Up CNPJ options:**

- **Format**: **Full** (default) returns the structured document (`razao_social`, `situacao_cadastral`, `endereco`,
  `cnae_principal`, `socios`, `simples`...). **Simplified** returns a flat document with DD/MM/YYYY dates and
  formatted CNPJ, ZIP code and phone (`nome`, `fantasia`, `situacao`, `atividade_principal`, `qsa`...). Both count as
  one lookup.
- **Continue If Not Found**: off (default) fails the item when the CNPJ is valid but not in the dataset. On returns
  `{ "cnpj": "...", "found": false }` and keeps the workflow going; route those items with an **If** node on
  `{{ $json.found === false }}`.

The node checks the CNPJ check digits before calling the API, so an invalid CNPJ fails right away without using a
lookup.

**Example workflow:** [`examples/lookup-cnpj.json`](examples/lookup-cnpj.json) (When clicking Execute workflow >
Validate CNPJ > Look Up CNPJ). Copy the file's content, paste it into the n8n editor and select your **Apipj API**
credential in the **Look Up CNPJ** node.

**AI Agent:** connect the node as a tool and set **CNPJ** to
`{{ $fromAI('cnpj', 'Company CNPJ, with or without punctuation') }}`.

### Limits and plans

| Plan | Price | Lookups per minute | Lookups per month |
| --- | --- | --- | --- |
| Free | R$ 0 | 10 | 50,000 |
| Dev | R$ 12.90/month | 30 | 200,000 |
| Pro | R$ 59.90/month | 200 | 600,000 |

- Upgrade: [Dev](https://apipj.com.br/painel?assinar=dev) · [Pro](https://apipj.com.br/painel?assinar=pro) ·
  [free account](https://apipj.com.br/criar-conta)
- **Per-minute limit** (HTTP 429 `rate_limited`): the node waits for the `Retry-After` header and retries up to 3
  times. For large lists on the free plan, use **Loop Over Items** with batches of 10 and a 60-second **Wait**.
- **Monthly quota used up** (HTTP 429 `quota_exceeded`): the node stops with a message and the upgrade link. No retry.
- API (5xx) or network instability: up to 3 retries, waiting 1 s, 2 s and 4 s.
- **On Error > Continue** (node settings) is supported: the failing item is output as `{ "error": "..." }` and the
  others go on.

### Compatibility

Tested with n8n 2.43.4 (`n8nio/n8n` Docker image).

### Development

```bash
npm install
npm run lint
npm run build
npm test                                               # mocked HTTP responses
APIPJ_TESTE_REAL=1 APIPJ_KEY=apipj_live_... npm test   # also calls the real API
npm run dev                                            # starts a local n8n with the node
```

Releases are published to npm by GitHub Actions ([`publish.yml`](.github/workflows/publish.yml)) when a `v*` tag is
pushed, with npm provenance.

### Links

- Website and API docs: <https://apipj.com.br> · <https://apipj.com.br/docs>
- Official JavaScript client: [apipj-js](https://github.com/apipj/apipj-js)
- Issues: <https://github.com/apipj/n8n-nodes-apipj/issues>

### License

[MIT](LICENSE.md)
