<div align="center">

# Crewstead

**Pequenos passos. Grandes entregas.**

Projetos, conversas e chamadas em um só lugar para equipes que constroem vários produtos.

![Go](https://img.shields.io/badge/backend-Go-00ADD8?style=flat-square&logo=go&logoColor=white)
![React](https://img.shields.io/badge/frontend-React-202321?style=flat-square&logo=react&logoColor=61DAFB)
![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Status](https://img.shields.io/badge/0.1.0-white?style=flat-square)

</div>

## O que é o Crewstead?

O Crewstead reúne o trabalho de pequenas equipes que cuidam de vários produtos. Em um só lugar, você pode acompanhar atividades, planejar entregas, trocar mensagens, compartilhar arquivos e fazer chamadas com as pessoas do projeto.

A ideia é ajudar a equipe a manter o contexto do trabalho e celebrar cada avanço, com uma experiência simples e sem distrações.

## O que você encontra

- Projetos, quadros de atividades e sprints para organizar as entregas.
- Canais, mensagens diretas e chamadas para conversar no contexto do trabalho.
- Compartilhamento de arquivos e acesso por projeto para colaboradores externos.

## Stack

| Camada | Tecnologias |
| --- | --- |
| Backend | Go · PostgreSQL · pgx/sqlc · River |
| Frontend | React · TypeScript · Vite · Tailwind |
| Comunicação | WebSocket · LiveKit/WebRTC |
| Infraestrutura | Docker Compose · Cloudflare R2 |

## Rodar localmente

Com Docker Engine e Docker Compose ativos, execute na raiz do projeto:

```sh
make start
```

No primeiro início, o comando pede o e-mail e a senha do administrador. Depois, abra [http://127.0.0.1:3000](http://127.0.0.1:3000) para acessar o Crewstead. Se você já tem uma instalação anterior à troca de nome, consulte as orientações de migração na documentação antes de iniciar esta versão.

## Vamos construir juntos

O projeto está em desenvolvimento. Sugestões sobre a experiência, novas ideias e contribuições são bem-vindas.

Para configurar, desenvolver, operar ou contribuir com código, consulte a [pasta de documentação técnica](./docs/).

**Licença:** será definida pelo mantenedor antes da primeira versão pública. Por enquanto, não há licença de código ou de marca definida.
