# Crewstead interface

## Direção

Interface operacional baseada no protótipo interativo aprovado (`crewstead-prototipo.html`): uma bancada clara de trabalho apoiada por navegação em carvão. Papel quente é a superfície principal, musgo dá estrutura e limão marca foco, êxito e progresso. A densidade serve ao trabalho; os exploradores pixelados (Capuz e Tela) aparecem em estados vazios, marcos, toasts e celebrações.

## Onde fica cada coisa

- `apps/web/src/styles/` — CSS por responsabilidade, portado do protótipo: `tokens` (cores, raios, sombras, tema Carvão), `base`, `shell`, `controls`, `board`, `overlays`, `home`, `chat`, `call`, `team`, `login`, `palette`, `responsive`.
- `apps/web/src/fonts/` — Schibsted Grotesk (interface), Archivo expandida (títulos e marca), JetBrains Mono (atalhos e dados) e Pixelify Sans (falas dos personagens), auto-hospedadas.
- `apps/web/src/design/` — peças reutilizáveis: motor de sprites procedural (`sprites.ts`, `Sprite.tsx`), partículas de pixel, sons, preferências (`prefs.ts`), ícones, toasts, menus, diálogos, celebração e tela final de sprint.
- `apps/web/src/shell/` — barra lateral, navegação móvel, cabeçalho, paleta Ctrl/Cmd K e notificações.
- `apps/web/src/screens/` — Início, Atividades (quadro, lista, gaveta), Sprints, Mensagens, Chamada, Equipe e Configurações.

## Estrutura e componentes

- Sidebar de 252 px no desktop (organização, destinos, projetos, canais, mascotes, conta); barra inferior no celular.
- Cabeçalho contextual com busca global (Ctrl/Cmd K), notificações e a ação principal da tela.
- Raios de 8, 12, 16 e 22 px; controles internos têm raios menores que as superfícies que os contêm.
- Atividades, conversas e gestão de equipe ocupam destinos separados. Detalhe de atividade abre em gaveta (`#/work/<id>`).

## Movimento e som

- Controles: transform e cor, 120–180 ms com `cubic-bezier(.16, 1, .3, 1)`. Entrada de superfícies: fade e 8 px por 220 ms.
- Concluir uma atividade solta partículas de pixel no cartão e Capuz comemora num toast; encerrar uma sprint abre a tela final com os dois personagens e um high five.
- Sons são bips curtos de onda quadrada, desligados por padrão e só depois de o usuário ligar em Configurações.
- "Reduzir animações" (Configurações) e `prefers-reduced-motion` param os personagens, cortam partículas e reduzem transições a 1 ms.

## Personagens

Capuz e Tela são desenhados em canvas, 32×40 pixels lógicos, com escala inteira e sem suavização. Poses: idle, wave, walk, think, cheer, highfive, sit, sleep, oops e load. Não usar como ornamento repetido: comunicam colaboração, progresso, espera e conclusão.
