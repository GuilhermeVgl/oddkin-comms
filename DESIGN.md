# ODDKIN interface

## Direção

Interface operacional baseada no protótipo interativo aprovado: uma bancada
clara de trabalho apoiada por navegação em carvão. O sistema usa papel quente
como superfície principal, musgo para estrutura e limão para foco, êxito e
progresso. A densidade serve ao trabalho; os exploradores pixelados aparecem
somente em estados vazios, marcos e celebrações.

## Tipografia e cor

- Schibsted Grotesk para interface e leitura contínua.
- Archivo variável, com largura expandida, para títulos, marca e grandes
  momentos.
- JetBrains Mono para atalhos e dados tabulares; Pixelify Sans fica reservado
  a falas curtas dos personagens.
- `#202321` carvão, `#63745a` musgo, `#dfff70` limão, `#f1f0e8` papel e branco.
- O limão identifica seleção, progresso e conclusão.

## Estrutura e componentes

- Sidebar de 252 px no desktop, com organização, destinos, mascotes e conta.
- Barra inferior fixa no celular; todas as áreas continuam acessíveis por nome
  e ícone.
- Cabeçalho contextual com busca global, notificações e criação rápida.
- Raios de 8, 12, 16 e 22 px. Controles internos usam raios menores que as
  superfícies que os contêm.
- Cartões usam borda quente e sombra curta. Áreas de quadro usam uma superfície
  rebaixada sem sombra.
- Atividades, conversas e gestão de equipe ocupam destinos separados; não
  empilhar módulos distintos numa única página longa.

## Movimento

- Controles: transform e cor, 120–180 ms com
  `cubic-bezier(.16, 1, .3, 1)`.
- Conclusões: celebração curta e isolada, acionada apenas quando uma atividade
  muda para concluída. Os exploradores fazem um encontro e retornam; redução de
  movimento mantém apenas o fade.
- Entrada de superfícies: fade e deslocamento vertical de 8 px por 220 ms.
- `prefers-reduced-motion` reduz animações e transições a 1 ms.

## Imagens

Os sprites fornecidos ficam em `assets/` e são exibidos por recortes CSS. Não
usar os personagens como ornamento repetido: eles comunicam colaboração,
progresso e conclusão.
