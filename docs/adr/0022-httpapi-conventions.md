# ADR 0022: Convenções dos handlers HTTP

## Estado

Aceita. Resultado do mapeamento de débito técnico de outubro de 2026.

## Contexto

Os handlers repetiam o mesmo bloco (abrir transação, rollback, commit, responder 503) em dezenas de lugares e respondiam 503 sem registrar a causa: uma falha de banco ou de LiveKit não deixava rastro. Os helpers estavam espalhados por arquivos de funcionalidade e o tipo principal se chamava `healthHandler` sem tratar de saúde.

## Decisão

- Os handlers são organizados em grupos por área (`identityAPI`, `workAPI`, `chatAPI`, `filesAPI`, `keysAPI`, `callsAPI`), cada um com os arquivos da sua área, e todos embutem o `server` compartilhado (banco e serviço de autenticação). `apiServer` apenas embute os grupos e satisfaz a interface gerada pelas promoções de métodos. Só o que é transversal fica no `*server`: `reader`, `mutator`, `activeSession`, `columnTx`, `inTx`. Um handler só alcança os helpers do próprio grupo, então uma dependência entre áreas aparece como erro de compilação. Helpers comuns ficam em `internal/httpapi/httpx.go`.
- **Erros de servidor** passam por `serverError(w, r, err)`: registra a rota, o `request_id` e a causa, responde 503 e nunca envia a causa ao cliente. Erros do PostgreSQL são registrados só por SQLSTATE, constraint e tabela, porque o detalhe pode citar valores de linhas. `cmd/api` define o logger como padrão do `slog`.
- **Transações** usam `h.inTx(ctx, func(q *sqlc.Queries) error)` com `respondError`: `statusError(código)` responde um status sem corpo, `errResponded` indica que um helper já respondeu, qualquer outro erro vira 503 registrado. A resposta de sucesso é escrita depois do commit. Chamadas a serviços externos (LiveKit, R2, e-mail) continuam fora da transação.
- **UUIDs**: `toPG` (API para banco), `fromPG`, `optionalUUID` e `uuidPtr`; sem conversões ad hoc.
- Handlers longos são divididos em funções privadas; regras puras vão para `internal/<domínio>` com teste unitário.

## Consequências

- Todo 503 deixa uma linha de log correlacionável com o `X-Request-Id` devolvido ao cliente.
- Novo handler com transação não repete o bloco de rollback/commit.
