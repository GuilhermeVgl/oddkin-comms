# ADR 0018: Arquitetura enxuta para uma instalação pequena

## Estado

Aceita por instrução do mantenedor. Substitui o que as ADRs 0002, 0004, 0010 e 0011 e a SPEC diziam sobre containers separados de migração, bootstrap, worker, Redis e simulador de e-mail.

## Contexto

A instalação atende poucas pessoas e roda em uma máquina. Cada container a mais é um ponto de falha, uma imagem para manter e um passo de ordenação no Compose, sem benefício em escala tão pequena.

## Decisão

Cinco serviços no Compose de desenvolvimento:

| Serviço    | Papel                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| `postgres` | Banco de dados e fila de jobs (River mora nele)                                    |
| `api`      | Um processo Go: HTTP/WebSocket, migrations, primeiro administrador e workers River |
| `livekit`  | Mídia das chamadas, nó único                                                       |
| `storage`  | MinIO, que simula o bucket R2 de arquivos                                          |
| `web`      | Vite com hot reload                                                                |

- **Migrations**: a API as aplica ao iniciar, sob o mesmo lock consultivo do `cmd/migrate`, que continua existindo como utilitário. `AUTO_MIGRATE=false` desliga. Com uma única instância da API não há corrida de migração; antes de escalar para várias réplicas, volte a migrar fora da API.
- **Primeiro administrador**: criado ao fim da própria etapa de migração (`migration.RunWithAdmin`, também usada pelo `cmd/migrate`) quando `ODDKIN_ADMIN_EMAIL` e `ODDKIN_ADMIN_PASSWORD` estão definidos e a instalação está vazia. Idempotente.
- **Jobs**: workers River rodam dentro da API. Jobs de e-mail só são registrados quando a Resend está configurada; sem isso ficam na fila.
- **Redis**: removido. O LiveKit roda em nó único e não precisa dele.
- **E-mail**: sempre a API real da Resend, com chaves no `.env`. O simulador local foi removido.
- **Arquivos**: o MinIO local fala a mesma API S3 que o R2. A API conversa com ele pelo endereço interno (`R2_ENDPOINT`) e assina as URLs para o endereço que o navegador alcança (`R2_PUBLIC_ENDPOINT`). `R2_CREATE_BUCKET=true` cria o bucket em desenvolvimento. Para usar o R2 de verdade, basta definir as variáveis `R2_*` no `.env`; o bucket precisa de uma regra CORS que permita PUT/GET da origem do app e exponha `ETag`.

## Consequências

- A API não é mais "stateless para escalar": um deploy com várias réplicas exige mover migrations e jobs para fora dela.
- A exceção à regra "API não migra ao iniciar" do `CLAUDE.md` é deliberada e está registrada ali.
- Redis volta à lista apenas se houver mais de um nó LiveKit.
