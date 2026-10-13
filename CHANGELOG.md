# Changelog

## 0.1.0

- Primeira versão: node "apipj (CNPJ)" com as operações Consultar CNPJ (formato completo ou simplificado,
  opção "Continuar Se Não Encontrado"), Validar CNPJ e Status da base.
- Credencial "Apipj API" (chave de API) com teste de conexão.
- Repetição automática em 429 `rate_limited` (respeita Retry-After, até 3 vezes) e em 5xx/falha de rede.
- Pode ser usado como ferramenta de AI Agent (`usableAsTool`).
