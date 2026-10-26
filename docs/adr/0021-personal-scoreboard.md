# ADR 0021: Placar pessoal, agradecimentos e modo foco

## Estado

Aceita. Mantém a promessa do README de que o produto é uma ferramenta pequena de trabalho: não há pontos nem ranking entre pessoas.

## Decisão

- **Só metadados.** O servidor guarda apenas quando uma atividade entrou numa coluna de concluído (`work_item.completed_at`, mantido por gatilho no banco, nulo ao reabrir), agradecimentos (`work_item_kudos`) e sessões de foco (`focus_session`, 1 a 180 minutos). Títulos e descrições continuam cifrados e nunca entram nas contas.
- **Crédito.** Uma entrega conta para quem é o responsável da atividade **no momento da consulta**; sem responsável ninguém pontua. Só tarefas contam, não subtarefas.
- **Endpoints.** `GET /me/stats` (apenas a própria conta), `PUT/DELETE /work-items/{id}/kudos`, `GET /work-items/{id}/engagement`, `POST /work-items/{id}/focus`. Todos exigem leitura da atividade; os de escrita exigem Origin e CSRF. Agradecer a si mesmo é 403; agradecer uma atividade não concluída ou sem responsável é 409; o responsável recebe uma notificação `kudos` na primeira vez.
- **Sequências** são calculadas no fuso da organização (`work.Streaks`): vale a corrida que termina hoje ou ontem.
- **Conquistas** são derivadas no cliente a partir de `/me/stats` (`design/gamify.ts`); o navegador só guarda quais já foram anunciadas, em armazenamento local, e só a própria pessoa as vê.
- **Efeitos** (confete, sons, marcos da sprint em 25/50/75/100%, resumo da sprint) respeitam "Reduzir animações" e "Sons discretos".

## Riscos conhecidos

- Reatribuir uma atividade concluída move o crédito para o novo responsável.
- Retirar e repetir um agradecimento notifica de novo.
