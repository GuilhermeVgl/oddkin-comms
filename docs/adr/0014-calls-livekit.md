# ADR 0014: Chamadas com LiveKit e admissão atômica

## Estado

Aceita, com uma lacuna conhecida: as chamadas ainda **não** têm criptografia de ponta a ponta ([ADR 0012](./0012-work-and-chat-v1.md)). A interface avisa isso dentro da sala. A SPEC 9.3 proíbe cair silenciosamente para mídia sem E2EE; este aviso é a exceção temporária e deve ser removida junto com a chave efêmera de chamada.

## Decisão

- Uma chamada pertence a uma conversa (canal ou DM) e há no máximo uma ativa por conversa (índice único parcial). Quem inicia precisa de `calls.start`; entrar exige `calls.join` e convite (ou ser o iniciador). `calls.screen_share` libera o compartilhamento. Em DM vale a elegibilidade do par.
- Convites são linhas próprias e geram notificação `call_invite` e os eventos `call.invited` e `call.changed`. Convidar não reserva vaga: convidar mais de quatro pessoas é permitido, e a vaga só existe após a admissão.
- Admissão: a transação trava a linha da chamada, expira reservas vencidas, conta as vagas (reservadas e ativas) e só então insere a reserva de 30 segundos. A sexta pessoa recebe 409 `call_full` sem credenciais. Um índice único parcial garante que uma conta ocupe no máximo uma vaga em todo o produto (`in_other_call`). Reconectar na mesma sessão renova a vaga; outro dispositivo recebe `other_device` e precisa pedir `transfer`.
- O token LiveKit vale 5 minutos, liga-se a uma sala e a uma identidade (o ID da conta), nunca cria nem administra salas, não publica dados e só publica microfone e câmera. A fonte de tela (e o áudio da tela) é concedida apenas a quem obteve o único compartilhamento da chamada, **dentro da sala**, com `UpdateParticipant` ([ADR 0020](./0020-call-record-and-ringing.md)); reconectar com um token novo foi abandonado porque o LiveKit via a pessoa sair e a chamada podia terminar.
- A sala é criada com `max_participants = 5` depois do commit; se a criação falhar, a chamada é encerrada. Nenhuma chamada ao LiveKit ocorre com lock de banco.
- Webhooks assinados (`/api/v1/webhooks/livekit`) são idempotentes por ID de evento e movem a vaga para entrou/saiu; uma conexão sem vaga válida (reuso de token, sala cheia) é removida. Um job periódico do River (`reconcile_calls`, 1 minuto) compara as vagas com os participantes reais: libera vaga ausente por mais de 45 s, remove conexões desconhecidas e encerra chamadas vazias há mais de 2 minutos.
- Terminar: o iniciador ou o gestor do projeto (em canais) encerra para todos; em DM o outro participante apenas sai. A chamada fecha ao ficar vazia e a sala é apagada. As linhas de admissão ficam como auditoria mínima de participação.
- Configuração: `LIVEKIT_URL` (WebSocket entregue ao navegador), `LIVEKIT_API_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, todas ou nenhuma, na API e no worker. O webhook do servidor LiveKit deve apontar para `/api/v1/webhooks/livekit` com a mesma chave. Sem configuração, as chamadas respondem 503.

## Não verificado

Nenhum teste rodou contra um LiveKit real: os testes de integração usam uma implementação em memória da administração de salas e conferem tokens e assinaturas de webhook localmente. Ficam pendentes a semântica de `max_participants` da versão fixada do LiveKit, TURN/TLS, o comportamento do cliente em redes reais, a qualidade de câmera e tela e a interface (não exercitada em navegador). Também não há serviço LiveKit nem Redis no Compose.
