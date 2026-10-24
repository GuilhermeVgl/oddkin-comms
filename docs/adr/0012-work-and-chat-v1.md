# ADR 0012: Trabalho e conversas da v1 sem criptografia de conteúdo

## Estado

Aceita, provisória. Decisão explícita do mantenedor: entregar uma v1 funcional antes das provas técnicas da Etapa 0 da SPEC.

## Contexto

A SPEC exige conteúdo cifrado de ponta a ponta (seções 6.3, 10). O diretório de chaves, dispositivos e envelopes ainda não existe, e a Etapa 0 (provas técnicas) não foi executada. Sem eles, o cliente não consegue cifrar.

## Decisão

- Sprints são da organização, com uma ativa por vez, atribuição de atividades por `planning.edit`, histórico e encerramento com decisão para toda pendência; internos veem nome e estado de todas as sprints, externos só as que contêm trabalho que podem ler.
- Projetos, membros, política de externos, colunas, épicos, atividades, subtarefas, comentários e mensagens de canal estão implementados com as relações, permissões e regras de concorrência da SPEC.
- Títulos, descrições, comentários e mensagens são armazenados como `text` em claro. Esta é uma exceção temporária à invariante 3 do `CLAUDE.md` e **não** deve receber dados reais sensíveis até a migração para o conteúdo cifrado.
- A migração para `bytea` cifrado exigirá uma migration nova, conversão dos dados existentes pelo cliente e atualização do contrato OpenAPI.
- A autorização, o isolamento por projeto (404 sem revelar existência), o versionamento otimista (409), a idempotência de mensagens por `clientMutationId` e a sequência de mensagens sem lacunas já seguem o desenho final.
- Conversas incluem DMs de par canônico (liberadas por projeto compartilhado com `direct_messages.use`), respostas citadas, reações, edição e exclusão com tombstone, moderação de canal pelo gestor e cursor de leitura com contagem de não lidas. As reações usam `chat.send` porque ainda não existe `chat.react`.
- Eventos: cada mutação grava, na mesma transação, entradas no feed por usuário (`user_event`, sequência por usuário sob lock da linha de cursor). `GET /api/v1/events/ws` (coder/websocket, mesma origem, sessão por cookie) entrega apenas referências, reautoriza cada evento na entrega, aceita retomada por cursor assinado (HMAC; chave aleatória por processo salvo `EventCursorKey`, então reiniciar a API exige novo snapshot) e responde `sync_required` para cursores forjados, de outra conta ou fora da janela de 7 dias. O feed é consultado a cada segundo por conexão (sem LISTEN/NOTIFY ainda) e a poda de eventos antigos não está agendada.
- Notificações internas: menção (com IDs validados no contexto), atribuição e mensagem direta. Faltam seguidores, comentário em item seguido e convite de chamada.
- `oapi-codegen/runtime` foi atualizado para v1.8.0, exigido pelo gerador fixado ao usar parâmetros de caminho.

## Fora desta decisão

DMs, reações, citações, anexos, chamadas, dispositivos e recuperação.
