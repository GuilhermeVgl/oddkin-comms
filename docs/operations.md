# Operação

Guia curto para quem mantém uma instalação do Crewstead. A arquitetura está na [ADR 0018](./adr/0018-lean-architecture.md).

## Configuração

Tudo vem de variáveis de ambiente; o `.env.example` lista as principais. A API falha ao iniciar, sem imprimir o valor, quando um grupo obrigatório está incompleto (e-mail, R2).

| Variável                                                                  | Para quê                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`                                                            | PostgreSQL                                            |
| `AUTO_MIGRATE`                                                            | `false` desliga a migração no início da API           |
| `CREWSTEAD_ADMIN_EMAIL`, `CREWSTEAD_ADMIN_PASSWORD`, `CREWSTEAD_TIMEZONE` | Primeiro administrador, criado só em instalação vazia |
| `CREWSTEAD_APP_NAME` (`APP_DISPLAY_NAME` na API, `VITE_APP_NAME` no Vite) | Nome exibido no produto e nos e-mails                 |
| `INVITATION_DELIVERY_KEY`                                                 | 32 bytes que selam os links enviados por e-mail       |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_PUBLIC_URL`                   | E-mail de convite e redefinição                       |
| `R2_*`, `STORAGE_QUOTA_BYTES`                                             | Bucket de arquivos e cota da organização              |
| `LIVEKIT_*`                                                               | Chamadas                                              |
| `RETENTION_SESSION_DAYS`, `RETENTION_CALL_DAYS`, `RETENTION_AUDIT_DAYS`   | Retenção (padrão 14, 30 e 180 dias)                   |

## Deploy com Kamal

O ambiente da Contabo usa `config/deploy.yml`. A imagem de produção contém a API e o frontend; PostgreSQL, LiveKit e MinIO rodam como acessórios persistentes na rede Docker `kamal`.

- A API acessa o armazenamento S3 pelo endereço interno `http://storage:9000`.
- O navegador usa `https://storage.5-253-232-59.sslip.io` apenas para transferências diretas por URLs pré-assinados.
- Os dados ficam em diretórios persistentes gerenciados pelo Kamal, fora do ciclo de vida dos containers.
- Todas as variáveis enviadas pelo Kamal vêm do `.env.production` local e ignorado pelo Git. A cópia `/root/.crewstead-secrets` na VPS preserva a origem das credenciais de infraestrutura geradas na primeira instalação.
- O Caddy de produção confia nos endereços privados da rede Docker para obter o IP pelo proxy e sobrescreve `X-Crewstead-Client-IP` antes de encaminhar à API. Somente a conexão local do Caddy pode fornecer esse cabeçalho à API; não exponha a porta interna da API ou o Caddy a proxies não confiáveis. Ao adicionar outro proxy, revise a cadeia de confiança e teste cabeçalhos falsificados.

Para um novo deploy, com a chave SSH autorizada e o arquivo remoto de segredos já criado:

```sh
kamal deploy
```

O acesso usa HTTPS/WSS com nomes temporários do `sslip.io`: `crewstead`, `storage` e `livekit` sob `5-253-232-59.sslip.io`. Substitua-os por nomes DNS próprios antes de depender desta instalação em produção.

## Retenção

Um job diário (`retention`) remove sessões e links de redefinição vencidos (14 dias), eventos com mais de sete dias, chamadas encerradas e seus webhooks (30 dias) e a auditoria de recuperação (180 dias). Arquivos apagados pelo usuário ficam no bucket por 30 dias e só então são eliminados, para que uma restauração do banco ainda encontre o objeto. Mensagens apagadas viram tombstone na base ativa, mas o texto cifrado antigo pode continuar nos backups até a retenção deles expirar.

## Backup e restauração

```sh
BACKUP_PASSPHRASE_FILE=/caminho/fora-do-servidor/frase scripts/backup.sh
```

- Gera `backups/daily/crewstead-<data>.dump.enc`, cifrado com AES-256 antes de sair do host. A frase fica **fora** do servidor.
- Mantém 14 diários e 4 semanais (os de domingo); `KEEP_DAILY` e `KEEP_WEEKLY` ajustam.
- Sem `DATABASE_URL`, usa o serviço `postgres` do Compose. Agende com cron e copie a pasta para outro bucket ou provedor, com credenciais próprias e de menor privilégio.

```sh
BACKUP_PASSPHRASE_FILE=/caminho/frase scripts/restore.sh backups/daily/<arquivo>.dump.enc "postgres://…/banco_vazio"
```

O script só restaura em banco **vazio** e nunca apaga nada. Depois, aponte a API para ele; as migrations não fazem nada se o esquema estiver atual.

Metas propostas: RPO de 24 horas e RTO de 4 horas, dependentes de um host de reposição e de um teste de restauração real.

**O que o script não prova.** Restaurar tabelas não comprova recuperação útil. Depois de restaurar, confirme com um dispositivo autorizado (ou a chave de recuperação) que uma atividade, uma DM e um arquivo abrem. O bucket R2 não é um backup: perder a conta do R2 perde os arquivos, e uma cópia em outra conta é decisão sua.

## Observabilidade

- Toda resposta traz `X-Request-Id`; quem reportar um erro pode citá-lo. Um id bem formado enviado pelo cliente é mantido.
- A API escreve uma linha JSON por requisição (`request_id`, `route`, `status`, `duration_ms`, `bytes`). A rota é o padrão (`/api/v1/projects/{projectId}`), nunca o caminho real, a query, cabeçalhos ou corpo. Verificações de saúde não são registradas.
- `GET /api/v1/health/live` e `/health/ready` (este testa o banco).
- Ainda não há endpoint de métricas: atraso de jobs, conexões, disco e cota precisam de monitoramento externo (a cota aparece em Configurações → Armazenamento para administradores).
