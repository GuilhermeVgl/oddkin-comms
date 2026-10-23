# ADR 0002 — Contratos, migrations e gates da fundação

Status: adotado para a fundação, 23/10/2026.

## Decisão

- O workspace usa Node 24.10.0 e pnpm 11.28.6. React, Vite, TypeScript, Vitest e Playwright ficam no frontend e nas ferramentas, sem runtime Node da API.
- OpenAPI gera servidor Go e tipos TypeScript; sqlc gera o acesso a dados a partir de `db/queries`. `make check-generated` regenera em memória ou diretório temporário e compara os artefatos, inclusive arquivos gerados inesperados.
- Goose aplica migrations da aplicação antes de River sob um lock consultivo PostgreSQL; API e worker não migram automaticamente. O primeiro schema limita a organização a uma instalação. O worker River inicial executa apenas uma tarefa de diagnóstico do banco.
- Os testes E2E de fundação iniciam banco, API e frontend reais, com Chromium e Firefox. O teste de containers constrói imagens Go em `scratch`, executa migrations e confere API e worker.
- `make security-check` consulta avisos Go e pnpm, varre arquivos do checkout e histórico com Gitleaks e bloqueia achados altos/críticos nas imagens finais de API, migration e worker com Trivy.
- O workflow de pull request executa `make gate` em Linux e valida todas as mensagens do intervalo da PR e o título proposto para squash. As actions usam hashes de commit fixados, permissões de leitura e não recebem segredos de produção. O workflow é validado com actionlint 1.7.12 em um módulo Go temporário, isolado das dependências dos geradores.

## Limites e risco conhecido

A imagem PostgreSQL 17.11 Alpine 3.24 é usada apenas em testes descartáveis neste incremento. Uma varredura Trivy 0.76.0 em 23/10/2026 encontrou 26 achados altos/críticos no binário `gosu`, compilado com Go 1.24.6, e nenhum pacote Alpine afetado. Essa imagem não faz parte do gate de imagens de runtime da aplicação; o resultado permanece registrado, sem lista de supressão. **Responsável:** mantenedor do repositório. **Revisão obrigatória até:** 30/11/2026, ou antes de adicionar Compose de produção. A imagem PostgreSQL de produção deverá passar sua própria avaliação antes de uso.

O E2E atual cobre só a superfície operacional. Não há usuários, autorização, eventos, E2EE, upload nem chamada implementados. Os critérios de aceite correspondentes continuam abertos. Os alvos de geração cobrem os contratos existentes; não existe schema de evento ainda.

Fontes: [River open source](https://github.com/riverqueue/river), [Goose](https://github.com/pressly/goose), [PostgreSQL container](https://hub.docker.com/_/postgres), [Playwright](https://playwright.dev/), [Trivy](https://trivy.dev/).
