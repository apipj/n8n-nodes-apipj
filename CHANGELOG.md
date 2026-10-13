# Changelog

## 0.1.1

- Published from GitHub Actions with npm provenance (trusted publishing). No functional changes.

## 0.1.0

- First release: "apipj (CNPJ)" node with the operations Look Up CNPJ (Full or Simplified format, optional
  "Continue If Not Found" returning `{ cnpj, found: false }`), Validate CNPJ and Get Dataset Status.
- "Apipj API" credential (API key) with a connection test.
- Automatic retry on 429 `rate_limited` (honors Retry-After, up to 3 times) and on 5xx/network failures;
  `quota_exceeded` stops with a link to upgrade the plan.
- Usable as an AI Agent tool (`usableAsTool`).
