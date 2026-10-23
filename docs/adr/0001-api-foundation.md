# ADR 0001 — Fundação inicial da API

Status: adotado para o primeiro incremento, 23/10/2026.

## Decisão

- Um módulo Go na raiz, com `go 1.27.3` e API HTTP em `cmd/api`.
- OpenAPI 3.0.3 é a fonte dos dois endpoints operacionais iniciais. `oapi-codegen` v2.8.0, fixado como ferramenta em `go.mod`, gera a interface e o roteamento `net/http` em `internal/httpapi/gen`.
- `pgx/v5` v5.11.0 fornece o pool PostgreSQL e a sondagem de prontidão. A API não migra o banco durante a inicialização.
- O teste de integração usa PostgreSQL 17.11 em Alpine 3.24, com digest de imagem fixado e dados sintéticos. O container e seu armazenamento são descartados ao final do teste.

## Motivo e limites

O contrato gerado evita definir rotas equivalentes à mão. Liveness indica que o processo atende HTTP; readiness depende de `Ping` no PostgreSQL com prazo de dois segundos. Erros do driver não são enviados na resposta. Este incremento não persiste conteúdo e não implementa autenticação, autorização ou operações do produto. Os testes de saúde não satisfazem os critérios de aceite de isolamento ou E2EE.

As versões de `oapi-codegen` e `pgx` foram escolhidas de releases oficiais mantidas. `oapi-codegen` usa Apache-2.0 e `pgx` usa MIT; PostgreSQL usa a imagem oficial. A inclusão de `pgx` é necessária para a stack especificada; o gerador é dependência de build, não do runtime da API.

Fontes: [oapi-codegen v2.8.0](https://github.com/oapi-codegen/oapi-codegen/releases/tag/v2.8.0), [licença oapi-codegen](https://github.com/oapi-codegen/oapi-codegen/blob/main/LICENSE), [pgx v5.11.0](https://github.com/jackc/pgx/releases/tag/v5.11.0), [licença pgx](https://github.com/jackc/pgx/blob/master/LICENSE), [PostgreSQL container](https://hub.docker.com/_/postgres).
