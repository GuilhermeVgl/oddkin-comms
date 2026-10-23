# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pequenas equipes que constroem e mantêm vários produtos de microSaaS. Há administradores da organização, gestores de projeto, membros internos, colaboradores externos e administradores de recuperação.

## Product Purpose

ODDKIN reúne planejamento, execução, conversas, arquivos e chamadas no contexto dos projetos. O produto deve permitir que uma equipe acompanhe o trabalho de vários produtos sem espalhar contexto por ferramentas diferentes.

## Positioning

Uma instalação própria para equipes pequenas, com projetos, trabalho, comunicação e chamadas no mesmo lugar e criptografia ponta a ponta do conteúdo desde sua primeira persistência.

## Operating Context

O fluxo começa por instalação de uma organização e convite de pessoas. A equipe alterna entre projetos, quadros de atividades, sprints globais, canais, mensagens diretas, arquivos e chamadas. Pessoas externas participam somente dos projetos autorizados e seguem uma política granular compartilhada por projeto.

## Capabilities and Constraints

- Não existe cadastro público.
- Um projeto contém épicos, atividades, subtarefas, colunas editáveis, canais e membros.
- Sprints podem reunir atividades de vários projetos sem expor projetos não autorizados.
- Chamadas usam LiveKit self-hosted e admitem no máximo cinco participantes.
- Arquivos de até 500 MB usam upload multipart direto ao R2 e criptografia incremental no cliente.
- Conteúdo de trabalho, arquivos e chamadas usam criptografia ponta a ponta; o servidor persiste ciphertext e metadados operacionais definidos na SPEC.
- O administrador de recuperação é uma capacidade criptográfica explícita e auditada.
- O frontend usa React e TypeScript; API e worker usam Go; PostgreSQL, River e Docker Compose são obrigatórios.
- A interface deve funcionar em desktop e mobile, com teclado, leitor de tela, zoom e redução de movimento.

## Brand Commitments

O nome é ODDKIN. A assinatura é “Pequenos passos. Grandes entregas.” A personalidade usa personagens pixelados e pequenas celebrações ao concluir entregas, sem pontos, ranking ou gamificação competitiva.

## Evidence on Hand

A fonte de verdade é [SPEC.md](./SPEC.md). Não há depoimentos, clientes públicos, métricas comerciais ou imagens de marca aprovadas; a interface não deve inventá-los.

## Product Principles

- Contexto de trabalho permanece junto do projeto.
- Isolamento e autorização são aplicados antes de qualquer dado ou metadado ser retornado.
- Criptografia não sofre downgrade silencioso.
- A interface reduz distrações e mantém ações frequentes claras.
- Operações concorrentes e retomadas preservam dados sem duplicação ou sobrescrita silenciosa.

## Accessibility & Inclusion

Fluxos principais devem funcionar por teclado e leitor de tela, suportar zoom e viewport mobile, oferecer alternativa ao arraste e respeitar preferência por movimento reduzido.
