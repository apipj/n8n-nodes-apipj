# n8n-nodes-apipj: consultar CNPJ no n8n (API CNPJ gratuita)

[![npm](https://img.shields.io/npm/v/n8n-nodes-apipj.svg)](https://www.npmjs.com/package/n8n-nodes-apipj)
[![licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE.md)

Community node do [n8n](https://n8n.io) para **consultar CNPJ** com a [apipj](https://apipj.com.br), uma **API CNPJ gratuita**
com os dados abertos da Receita Federal: razão social, nome fantasia, situação cadastral, endereço (com código IBGE do
município), CNAE principal e secundários, sócios (QSA), Simples Nacional e MEI. Também valida CNPJ numérico e
**CNPJ alfanumérico** (IN RFB 2.229/2024) e funciona como ferramenta de **AI Agent**.

- Plano grátis: 50.000 consultas por mês, sem cartão. [Crie sua conta](https://apipj.com.br/criar-conta).
- Validar CNPJ e Status da base não precisam de chave e não gastam cota.
- Sem dependências em tempo de execução.

## Instalação

### n8n self-hosted (pela interface)

1. Abra **Settings > Community Nodes**.
2. Clique em **Install**.
3. Digite `n8n-nodes-apipj`, marque a confirmação de risco e clique em **Install**.

O node aparece no painel como **apipj (CNPJ)**. Veja também a
[documentação do n8n sobre community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

### Instalação manual (Docker / fila / sem acesso à interface)

```bash
# dentro do container ou servidor do n8n
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install n8n-nodes-apipj
# reinicie o n8n
```

> No n8n Cloud só aparecem community nodes verificados pelo n8n.

## Credencial

1. Crie uma conta grátis em <https://apipj.com.br/criar-conta> e copie a chave de API no painel (começa com `apipj_live_`).
2. No n8n, crie uma credencial **Apipj API** e cole a chave em **Chave De API**.
3. Clique em **Save**: o n8n testa a chave com uma consulta ao CNPJ 00.000.000/0001-91 (gasta 1 consulta da cota).

A chave só é exigida pela operação **Consultar CNPJ**. **Validar CNPJ** e **Status da base** funcionam sem credencial.

## Operações

| Operação | Endpoint | Chave | Gasta cota | O que devolve |
| --- | --- | --- | --- | --- |
| **Consultar CNPJ** | `GET /v1/cnpj/{cnpj}` | sim | sim | Cadastro completo da empresa |
| **Validar CNPJ** | `GET /v1/valida/{cnpj}` | não | não | `{ cnpj, valido, formatado, alfanumerico, erro }` |
| **Status da base** | `GET /v1/status` | não | não | `{ status, dataset_month, rows, ... }` (mês de referência da base) |

O campo **CNPJ** aceita o número com ou sem máscara (`00.000.000/0001-91` ou `00000000000191`) e o CNPJ alfanumérico
(`12.ABC.345/01DE-35`). Tudo que não for letra ou número é removido e as letras viram maiúsculas. Se uma expressão
devolver um número (por exemplo uma coluna de planilha que perdeu os zeros à esquerda), o node completa com zeros até
14 dígitos.

### Opções de Consultar CNPJ

- **Formato**
  - `Completo` (padrão): documento estruturado, com `razao_social`, `nome_fantasia`,
    `situacao_cadastral { codigo, descricao, data, motivo }`, `endereco { ..., municipio { codigo_ibge, nome } }`,
    `cnae_principal`, `cnaes_secundarios`, `socios`, `simples` e mais.
  - `Simplificado`: formato plano, com datas `DD/MM/AAAA` e CNPJ, CEP e telefone já formatados
    (`nome`, `fantasia`, `situacao`, `atividade_principal`, `qsa`...).
- **Quando Não Encontrado**
  - `Parar Com Erro` (padrão): o item falha se o CNPJ é válido mas não está na base da Receita Federal.
  - `Continuar Se Não Encontrado`: devolve `{ "cnpj": "...", "encontrado": false }` e segue o workflow.
    Use um node **IF** com `{{ $json.encontrado === false }}` para separar esses casos.

Antes de chamar a API, o node confere os dígitos verificadores do CNPJ: um CNPJ inválido falha na hora e não gasta
consulta.

### Exemplos de expressões

```text
{{ $json.razao_social }}
{{ $json.situacao_cadastral.descricao }}          // ATIVA, BAIXADA, INAPTA...
{{ $json.endereco.municipio.codigo_ibge }}
{{ $json.cnae_principal.codigo }}
{{ $json.socios.map(s => s.nome).join(', ') }}
```

## Exemplo de workflow

O arquivo [`examples/consultar-cnpj.json`](examples/consultar-cnpj.json) tem o fluxo
**Ao clicar em Executar > Validar CNPJ > Consultar CNPJ**. Para usar: copie o conteúdo do arquivo, cole no editor do
n8n (Ctrl+V) e escolha a sua credencial **Apipj API** no node **Consultar CNPJ**.

Saída resumida de **Consultar CNPJ** para `00.000.000/0001-91`:

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

Para enriquecer uma lista (planilha, CRM, formulário), ligue a fonte de dados ao node **Consultar CNPJ** com
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
- **Continue On Fail** (Settings do node > On Error > Continue) é suportado: o item com problema sai como
  `{ "error": "..." }` e os outros seguem.

## Erros comuns

| Mensagem | O que fazer |
| --- | --- |
| A chave de API do apipj foi recusada | Confira a chave na credencial **Apipj API**. |
| O valor do campo 'CNPJ' não é um CNPJ válido | Confira os 14 caracteres e os dígitos verificadores. Nenhuma consulta foi gasta. |
| O CNPJ ... não está na base da Receita Federal | CNPJ válido mas inexistente. Use **Continuar Se Não Encontrado** para seguir o fluxo. |
| A cota mensal de consultas do seu plano apipj acabou | Assine o plano Dev ou Pro, ou espere a virada do mês. |

## Compatibilidade

Testado com n8n 2.43.4 (imagem Docker `n8nio/n8n`).

## Desenvolvimento

```bash
npm install
npm run lint
npm run build
npm test                                          # testes com respostas simuladas
APIPJ_TESTE_REAL=1 APIPJ_KEY=apipj_live_... npm test   # inclui chamadas reais à API
npm run dev                                       # sobe um n8n local com o node
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

**n8n-nodes-apipj** is an n8n community node for [apipj](https://apipj.com.br), a free Brazilian CNPJ (company registry)
lookup API backed by Receita Federal open data.

- **Install:** Settings > Community Nodes > Install > `n8n-nodes-apipj`.
- **Credential:** create a free account at <https://apipj.com.br/criar-conta>, copy the API key (`apipj_live_...`) and
  add it to an **Apipj API** credential. Only the lookup operation needs it.
- **Operations:** *Consultar CNPJ* (company lookup, `completo` or `simplificado` format, optional "continue if not
  found" that returns `{ cnpj, encontrado: false }`), *Validar CNPJ* (check digit validation, numeric and alphanumeric
  CNPJ, no key, no quota) and *Status da base* (dataset month and size, no key).
- **Limits:** free plan 10 requests/min and 50,000/month. HTTP 429 `rate_limited` is retried up to 3 times honoring
  `Retry-After`; `quota_exceeded` stops with a link to upgrade.
- Usable as an AI Agent tool. MIT licensed. No runtime dependencies.
