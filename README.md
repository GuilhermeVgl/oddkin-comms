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

O desenvolvimento está na fundação. Há API Go com endpoints de saúde gerados a partir de OpenAPI, cliente TypeScript gerado, frontend React inicial, migrations Goose/River, worker River com tarefa de diagnóstico, convites de organização persistidos, hash de senhas Argon2id e adaptador de envio pela API da Resend testado localmente. O adaptador ainda não é chamado por um fluxo de produto. O Makefile reúne geração, testes unitários, integração, E2E em Chromium/Firefox, cobertura, segurança, build e smoke de containers. O Compose da raiz inicia esta fundação localmente; os recursos de produto acima ainda não estão implementados. Não há autenticação, conteúdo cifrado ou configuração de produção.

- [Especificação funcional e técnica](./SPEC.md)
- [Regras de desenvolvimento, TDD e quality gates](./CLAUDE.md)

Sugestões sobre escopo, experiência e arquitetura são bem-vindas. Para contribuir com a implementação, comece pela spec e pelas regras de desenvolvimento.

### Rodar localmente com Docker

Com Docker Engine e Compose ativos, na raiz do repositório:

```sh
docker compose up -d
```

Abra `http://127.0.0.1:3000`. O mesmo endereço encaminha `/api/*` à API; `curl -i http://127.0.0.1:3000/api/v1/health/ready` deve responder `204`. O Compose inicia PostgreSQL com volume persistente, executa as migrations e inicia API, worker e frontend. `docker compose down` para os serviços e mantém os dados; `docker compose down --volumes` também apaga o banco local. A configuração usa senha fixa de desenvolvimento e expõe a porta web apenas no loopback: não é uma implantação pública ou de produção. Para escolher outra porta local, use `ODDKIN_WEB_BIND=127.0.0.1:3001 docker compose up -d`.

Para verificar mensagens de commits novos, use `make commit-check COMMIT_BASE=<base> COMMIT_HEAD=<head>`. Para validar uma mensagem preparada para squash, use `make commit-check COMMIT_MSG_FILE=<caminho>`. Os testes desse gate rodam com `make test-commitcheck`. O hook local pode ser instalado com `./scripts/install-hooks.sh`; o instalador preserva uma configuração `core.hooksPath` já existente.

Instale as versões fixadas de Go e Node/pnpm e as versões mínimas de Docker Engine e Compose indicadas no repositório. Rode `corepack pnpm install --frozen-lockfile` e `corepack pnpm exec playwright install chromium firefox`. `make doctor` verifica ferramentas e portas de teste; `make gate` executa as verificações da fundação. Os testes com PostgreSQL e containers requerem o daemon Docker. `make generate` atualiza OpenAPI Go/TS e sqlc; `make check-generated` compara os resultados sem alterar o checkout.

Para executar a API manualmente, configure `DATABASE_URL` para um PostgreSQL próprio de desenvolvimento, rode `go run ./cmd/migrate` e depois `go run ./cmd/api`. `HTTP_ADDR` é opcional e usa `:8080` por padrão. `GET /api/v1/health/live` responde 204 com o processo ativo; `GET /api/v1/health/ready` responde 204 quando o banco está acessível ou 503 caso contrário. O frontend inicial pode ser aberto com `corepack pnpm --filter @oddkin/web dev`.

Para verificar um envio real pela Resend, configure `RESEND_API_KEY` e `RESEND_FROM_EMAIL` no ambiente do processo e execute `go run ./cmd/email-smoke -to destinatario@exemplo.com`. O remetente deve pertencer a um domínio verificado na Resend. O comando envia apenas uma mensagem diagnóstica fixa e informa o ID aceito pelo provedor; ele não comprova entrega na caixa postal. Não use credenciais reais nos testes automatizados.

As decisões e limites deste incremento estão em [ADR 0001](./docs/adr/0001-api-foundation.md), [ADR 0002](./docs/adr/0002-bootstrap-tooling.md), [ADR 0003](./docs/adr/0003-invitation-tokens.md), [ADR 0004](./docs/adr/0004-organization-invitations.md), [ADR 0005](./docs/adr/0005-resend-transactional-email.md) e [ADR 0006](./docs/adr/0006-password-hashing.md).

**Licença:** será definida pelo mantenedor antes da primeira release pública. Nenhuma licença de código ou de marca é presumida nesta etapa.

---

<div align="center">Criar. Testar. Repetir.</div>
