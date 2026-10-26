# ADR 0020: Registro de chamadas, toque de ligação e compartilhamento de tela na sala

## Estado

Aceita. Complementa a [ADR 0014](./0014-calls-livekit.md) e substitui o que ela dizia sobre conceder a fonte de tela reconectando com um token novo.

## Contexto

Três problemas apareceram no uso real das chamadas:

1. Compartilhar a tela desconectava a pessoa da sala para reconectar com um token que permitia a tela. O LiveKit via a saída, o webhook marcava a vaga como `left` e, se a pessoa estava sozinha, a chamada terminava.
2. Nada ficava registrado na conversa depois que a chamada acabava, e o convite chegava só como um aviso de 6 segundos.
3. Só telas inteiras devem ser compartilhadas, com ou sem o som.

## Decisão

- **Tela dentro da sala.** `POST /calls/{id}/screen-share` toma o único slot de apresentador em transação e, depois do commit e fora de qualquer lock, chama `UpdateParticipant` para permitir `screen_share` e `screen_share_audio` àquela identidade. Se o LiveKit falhar, o slot é devolvido e a resposta é 503 (registrada). `DELETE` devolve o slot e revoga a permissão. O navegador espera o evento de permissão antes de publicar e só aceita monitores (`displaySurface = monitor`; janelas e abas são recusadas depois da escolha).
- **Registro.** `GET /calls/history?conversationId=` devolve as chamadas da conversa, mais recentes primeiro: quem iniciou, quem **entrou** de fato (reservas que nunca viraram vaga não contam), início, fim, motivo e duração. `answered` é verdadeiro com pelo menos duas pessoas; caso contrário a chamada é "perdida" para quem foi chamado. Vale a mesma autorização de leitura da conversa. São metadados operacionais: não há conteúdo de mídia nem de mensagens.
- **Toque.** Convites pendentes (`call.invited` / `call.changed`) viram um cartão com Atender e Recusar e um toque gerado no navegador (Web Audio, sem arquivo de som), por 45 segundos depois da criação da chamada; depois disso o convite segue visível na conversa. Com a pessoa já em outra chamada o cartão aparece sem tocar. O toque não depende da preferência de sons discretos; o navegador pode mantê-lo mudo até a primeira interação.

## Consequências

- O índice de uma pessoa por vaga e o limite de cinco continuam valendo; a permissão de tela é apenas mais um estado da mesma sala.
- Falha transitória ao revogar a permissão de tela (o erro é ignorado hoje) pode deixar a permissão sem o slot; não afeta confidencialidade, só a regra de um apresentador por vez. Registrar como risco conhecido.
- O histórico de chamadas mostra e-mails de participantes a quem lê o canal, inclusive chamadas anteriores à entrada da pessoa; revisar se convites sem histórico (`history_mode = none`) devem ocultar isso.
