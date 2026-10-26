# Operação

Guia curto para quem mantém uma instalação do ODDKIN. A arquitetura está na [ADR 0018](./adr/0018-lean-architecture.md).

## Configuração

Tudo vem de variáveis de ambiente; o `.env.example` lista as principais. A API falha ao iniciar, sem imprimir o valor, quando um grupo obrigatório está incompleto (e-mail, R2).

| Variável                                                                | Para quê                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`                                                          | PostgreSQL                                            |
| `AUTO_MIGRATE`                                                          | `false` desliga a migração no início da API           |
| `ODDKIN_ADMIN_EMAIL`, `ODDKIN_ADMIN_PASSWORD`, `ODDKIN_TIMEZONE`        | Primeiro administrador, criado só em instalação vazia |
| `INVITATION_DELIVERY_KEY`                                               | 32 bytes que selam os links enviados por e-mail       |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_PUBLIC_URL`                 | E-mail de convite e redefinição                       |
| `R2_*`, `STORAGE_QUOTA_BYTES`                                           | Bucket de arquivos e cota da organização              |
| `LIVEKIT_*`                                                             | Chamadas                                              |
| `RETENTION_SESSION_DAYS`, `RETENTION_CALL_DAYS`, `RETENTION_AUDIT_DAYS` | Retenção (padrão 14, 30 e 180 dias)                   |

## Retenção

Um job diário (`retention`) remove sessões e links de redefinição vencidos (14 dias), chamadas encerradas e seus webhooks (30 dias) e a auditoria de recuperação (180 dias). Arquivos apagados pelo usuário ficam no bucket por 30 dias e só então são eliminados, para que uma restauração do banco ainda encontre o objeto. Mensagens apagadas viram tombstone na base ativa, mas o texto cifrado antigo pode continuar nos backups até a retenção deles expirar.

## Backup e restauração

```sh
BACKUP_PASSPHRASE_FILE=/caminho/fora-do-servidor/frase scripts/backup.sh
```

- Gera `backups/daily/oddkin-<data>.dump.enc`, cifrado com AES-256 antes de sair do host. A frase fica **fora** do servidor.
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
