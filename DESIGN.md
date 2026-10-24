# ODDKIN interface

## Direção

Interface operacional inspirada no mockup aprovado: uma bancada clara de
trabalho dentro de uma moldura de produto em carvão. O sistema usa papel quente
como superfície principal, musgo para estrutura e limão para foco, êxito e
progresso. A densidade serve ao trabalho; os exploradores pixelados aparecem
somente em estados vazios, marcos e celebrações.

## Tipografia e cor

- DM Sans para toda a interface e dados.
- Bodoni Moda somente para a mensagem de entrada e grandes momentos de marca.
- `#202321` carvão, `#63745a` musgo, `#dfff70` limão, `#f1f0e8` papel e branco.
- O limão identifica seleção, progresso e conclusão.

## Movimento

- Controles: transform e cor, 150 ms com `cubic-bezier(.23, 1, .32, 1)`.
- Conclusões: celebração curta e isolada, acionada apenas quando uma atividade
  muda para concluída. Os exploradores fazem um encontro e retornam; redução de
  movimento mantém apenas o fade.
- Listas e dados não recebem coreografia de entrada.

## Imagens

Os sprites fornecidos ficam em `assets/` e são exibidos por recortes CSS. Não
usar os personagens como ornamento repetido: eles comunicam colaboração,
progresso e conclusão.
