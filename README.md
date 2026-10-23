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

| Camada | Tecnologias |
| --- | --- |
| Backend | Go · PostgreSQL · pgx/sqlc · River |
| Frontend | React · TypeScript · Vite · Tailwind |
| Comunicação | WebSocket · LiveKit/WebRTC |
| Infraestrutura | Docker Compose · Cloudflare R2 |

## 🔐 Privacidade por projeto

A arquitetura prevê criptografia ponta a ponta para conteúdo de trabalho, arquivos e chamadas. O administrador autorizado poderá recuperar o histórico; metadados necessários ao funcionamento continuarão visíveis ao servidor. Os detalhes e limites estão na [spec](./SPEC.md#10-criptografia-e-recuperação-administrativa).

## 🚧 Estado do projeto

O desenvolvimento começou pela fundação do repositório e pela verificação de mensagens de commit (AC-43). Os recursos acima são o escopo planejado; ainda não há aplicação funcional ou instalação pronta. O gate completo, os geradores, a infraestrutura e os testes de produto ainda não existem.

- [Especificação funcional e técnica](./SPEC.md)
- [Regras de desenvolvimento, TDD e quality gates](./CLAUDE.md)

Sugestões sobre escopo, experiência e arquitetura são bem-vindas. Para contribuir com a implementação, comece pela spec e pelas regras de desenvolvimento.

Para verificar mensagens de commits novos, use `make commit-check COMMIT_BASE=<base> COMMIT_HEAD=<head>`. Para validar uma mensagem preparada para squash, use `make commit-check COMMIT_MSG_FILE=<caminho>`. Os testes desse gate rodam com `make test-commitcheck`. O hook local pode ser instalado com `./scripts/install-hooks.sh`; o instalador preserva uma configuração `core.hooksPath` já existente.

**Licença:** será definida pelo mantenedor antes da primeira release pública. Nenhuma licença de código ou de marca é presumida nesta etapa.

---

<div align="center">Criar. Testar. Repetir.</div>
