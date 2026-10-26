# ADR 0013: Anexos com multipart direto ao bucket

## Estado

Aceita. O corpo passou a ser cifrado no cliente pela [ADR 0019](./0019-encrypted-file-bodies.md); este texto descreve o transporte, que continua valendo (o tamanho reservado é o cifrado).

## Decisão

- O limite é 500.000.000 bytes do arquivo original: 500.000.000 é aceito e 500.000.001 recebe 413. O tamanho enviado precisa ser igual ao armazenado enquanto não houver formato cifrado; a fórmula do overhead substituirá essa checagem.
- A API nunca recebe o conteúdo. `POST /uploads` reserva a cota da organização e o único envio ativo por pessoa (índice único parcial) numa transação com lock da linha da organização, e só depois cria o multipart no bucket (sem lock de banco durante a chamada externa). Falhas entre as etapas deixam a linha marcada para reconciliação.
- Partes de 8 MiB, URLs presignadas de 15 minutos por parte e, no máximo, duas partes em trânsito no cliente. O cliente lê uma fatia por vez (`Blob.slice`) e reenvia os mesmos bytes ao repetir uma parte.
- `complete` valida a lista de partes, chama o bucket sem lock de banco, confere o tamanho real e publica o anexo de forma atômica; tamanho divergente descarta o objeto. É idempotente.
- Downloads são autorizados a cada pedido e devolvem URL presignada de 60 segundos. O bucket permanece privado; o nome do objeto é aleatório.
- Permissões: `files.download` e `files.upload` na política de externos (upload exige download). O contexto também precisa permitir escrever (comentar ou enviar mensagem). DMs usam apenas a elegibilidade da conversa.
- Remoção e envios abandonados (24 h) marcam a linha e liberam o objeto; um job periódico do River tenta de novo o que falhar.
- Configuração: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (todas ou nenhuma), `R2_PATH_STYLE=true` para endpoints locais, `STORAGE_QUOTA_BYTES` (padrão 50 GB). Sem credenciais os envios respondem 503.
- O CORS do bucket deve permitir `PUT` e `GET` da origem do app e expor o cabeçalho `ETag`.

## Não verificado

Nenhum teste rodou contra o R2 ou um servidor S3 real: os testes de integração usam um armazenamento em memória e verificam as URLs presignadas localmente. O envio de 500 MB com memória medida, o CORS real e o caminho de download em stream continuam pendentes.
