<div align="center">

# ODDKIN

**Pequenos passos. Grandes entregas.**

Projetos, conversas e chamadas em um só lugar para equipes que constroem vários produtos.

![Go](https://img.shields.io/badge/backend-Go-00ADD8?style=flat-square&logo=go&logoColor=white)
![React](https://img.shields.io/badge/frontend-React-202321?style=flat-square&logo=react&logoColor=61DAFB)
![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Status](https://img.shields.io/badge/status-em_desenvolvimento-63745A?style=flat-square)

</div>

---

ODDKIN é uma ferramenta web de colaboração pensada para pequenas equipes de microSaaS. A proposta é reunir o trabalho de vários projetos com uma interface simples, identidade própria e pequenas celebrações ao concluir entregas.

**Hospedagem própria, escopo enxuto e um projeto pensado para ser open source.**

## ✨ O que estamos construindo

- **Trabalho organizado:** épicos, atividades, subtarefas, responsáveis, prazos e quadros configuráveis.
- **Sprints da equipe:** atividades de diferentes projetos no mesmo ciclo.
- **Conversas no contexto:** canais por projeto e mensagens diretas, com menções, reações e respostas citadas.
- **Chamadas rápidas:** áudio, vídeo e compartilhamento de tela para até **5 pessoas**.
- **Colaboração com externos:** acesso por projeto e permissões configuráveis.
- **Arquivos protegidos:** anexos de até **500 MB**, com criptografia no cliente e armazenamento no R2.
- **Personalidade sem distração:** personagens pixelados e animações discretas, sem rankings ou pontos.

## 🛠️ Stack

| Camada         | Tecnologias                          |
| -------------- | ------------------------------------ |
| Backend        | Go · PostgreSQL · pgx/sqlc · River   |
| Frontend       | React · TypeScript · Vite · Tailwind |
| Comunicação    | WebSocket · LiveKit/WebRTC           |
| Infraestrutura | Docker Compose · Cloudflare R2       |

## 🔐 Privacidade por projeto

A arquitetura prevê criptografia ponta a ponta para conteúdo de trabalho, arquivos e chamadas. O administrador autorizado poderá recuperar o histórico; metadados necessários ao funcionamento continuarão visíveis ao servidor. Os detalhes e limites estão na [spec](./SPEC.md#10-criptografia-e-recuperação-administrativa).

## 🚧 Estado do projeto

O produto inclui projetos, membros, externos, quadro de trabalho, épicos, atividades, subtarefas, comentários, sprints, canais, DMs, notificações, anexos de até 500 MB e chamadas para até cinco pessoas. O Compose da raiz inicia API, worker, banco, armazenamento local, LiveKit e interface web. Conteúdo de trabalho, DMs, nomes de projetos, canais, sprints e arquivos usa envelopes E2EE no navegador; a mídia das chamadas também usa E2EE via LiveKit. O corpo binário dos anexos ainda aguarda o formato de streaming E2EE e domínios individuais de arquivo descritos na SPEC.

- [Especificação funcional e técnica](./SPEC.md)
- [Regras de desenvolvimento, TDD e quality gates](./CLAUDE.md)

Sugestões sobre escopo, experiência e arquitetura são bem-vindas. Para contribuir com a implementação, comece pela spec e pelas regras de desenvolvimento.

### Rodar localmente com Docker

Com Docker Engine e Compose ativos, na raiz do repositório:

```sh
docker compose up -d
```

Abra `http://127.0.0.1:3000` e entre pela interface. O mesmo endereço encaminha `/api/*` à API; `curl -i http://127.0.0.1:3000/api/v1/health/ready` deve responder `204`. No primeiro início, o Compose cria a organização e a conta local `admin@oddkin.local` com a senha `oddkin-local-password`. Defina `ODDKIN_ADMIN_EMAIL`, `ODDKIN_ADMIN_PASSWORD` e `ODDKIN_TIMEZONE` antes do primeiro `up` para escolher outros valores. O bootstrap é atômico e não altera uma instalação existente.

O serviço `web` roda pelo Vite em modo de desenvolvimento. Arquivos de `apps/web`, `packages` e `assets` ficam montados no container; alterações em React e CSS aparecem por hot reload sem rebuild. O primeiro início instala as dependências no volume `web_node_modules`; os próximos reutilizam esse volume.

O Compose inicia PostgreSQL com volume persistente, executa as migrations e inicia API, worker, frontend e uma caixa local compatível com o endpoint da Resend. Administradores podem criar convites pela tela; abra `http://127.0.0.1:8025` para ler o e-mail local e seguir o link de aceite. `docker compose down` para os serviços e mantém os dados; `docker compose down --volumes` também apaga o banco local. A configuração usa credenciais e chaves sintéticas de desenvolvimento e expõe as portas apenas no loopback: não é uma implantação pública ou de produção. Para escolher outras portas, defina `ODDKIN_WEB_BIND`, `ODDKIN_RESEND_BIND` e `ODDKIN_PUBLIC_URL` de forma coerente antes de executar o Compose.

Para verificar mensagens de commits novos, use `make commit-check COMMIT_BASE=<base> COMMIT_HEAD=<head>`. Para validar uma mensagem preparada para squash, use `make commit-check COMMIT_MSG_FILE=<caminho>`. Os testes desse gate rodam com `make test-commitcheck`. O hook local pode ser instalado com `./scripts/install-hooks.sh`; o instalador preserva uma configuração `core.hooksPath` já existente.

Instale as versões fixadas de Go e Node/pnpm e as versões mínimas de Docker Engine e Compose indicadas no repositório. Rode `corepack pnpm install --frozen-lockfile` e `corepack pnpm exec playwright install chromium firefox`. `make doctor` verifica ferramentas e portas de teste; `make gate` executa as verificações da fundação. Os testes com PostgreSQL e containers requerem o daemon Docker. `make generate` atualiza OpenAPI Go/TS e sqlc; `make check-generated` compara os resultados sem alterar o checkout.

Para executar a API manualmente, configure `DATABASE_URL` para um PostgreSQL próprio de desenvolvimento, rode `go run ./cmd/migrate` e depois `go run ./cmd/api`. `HTTP_ADDR` é opcional e usa `:8080` por padrão. `GET /api/v1/health/live` responde 204 com o processo ativo; `GET /api/v1/health/ready` responde 204 quando o banco está acessível ou 503 caso contrário. O frontend pode ser aberto com `corepack pnpm --filter @oddkin/web dev`; o proxy de desenvolvimento encaminha `/api` para a API local.

Em uma implantação real, o worker exige `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_PUBLIC_URL` e uma `INVITATION_DELIVERY_KEY` aleatória de 32 bytes, compartilhada com a API. Não configure `RESEND_API_URL`: essa opção existe para o stub local do Compose. O remetente deve pertencer a um domínio verificado na Resend. Para verificar as credenciais separadamente, execute `go run ./cmd/email-smoke -to destinatario@exemplo.com`; o comando informa o ID aceito pelo provedor, mas não comprova entrega na caixa postal. Não use credenciais reais nos testes automatizados.

As decisões e limites deste incremento estão em [ADR 0001](./docs/adr/0001-api-foundation.md), [ADR 0002](./docs/adr/0002-bootstrap-tooling.md), [ADR 0003](./docs/adr/0003-invitation-tokens.md), [ADR 0004](./docs/adr/0004-organization-invitations.md), [ADR 0005](./docs/adr/0005-resend-transactional-email.md), [ADR 0006](./docs/adr/0006-password-hashing.md), [ADR 0007](./docs/adr/0007-account-session-schema.md), [ADR 0008](./docs/adr/0008-session-secrets.md), [ADR 0009](./docs/adr/0009-http-sessions.md), [ADR 0010](./docs/adr/0010-initial-administrator.md), [ADR 0011](./docs/adr/0011-invitation-delivery.md), [ADR 0012](./docs/adr/0012-work-and-chat-v1.md), [ADR 0013](./docs/adr/0013-attachments-multipart.md) [ADR 0014](./docs/adr/0014-calls-livekit.md), [ADR 0015](./docs/adr/0015-e2ee-key-directory.md), [ADR 0016](./docs/adr/0016-client-side-encryption.md) e [ADR 0017](./docs/adr/0017-dm-names-and-recovery.md).

**Licença:** será definida pelo mantenedor antes da primeira release pública. Nenhuma licença de código ou de marca é presumida nesta etapa.

---

<div align="center">Criar. Testar. Repetir.</div>
