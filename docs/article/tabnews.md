# Estou construindo uma ferramenta de trabalho e chamadas que fica no seu servidor e que nem eu consigo ler (open source, preciso de feedback)

> Rascunho para publicar no TabNews. As imagens e o vídeo apontam para `docs/article/` no repositório: faça o commit e o push dessa pasta antes de postar, ou troque os links. Os dados dos prints são todos sintéticos (equipe "Oddkin Studio", projeto "Lumen"), gerados numa instância de demonstração.

---

Fala, pessoal.

Esse é um post de apresentação, e já aviso que também é um pedido de ajuda. Vou contar o que estou construindo, mostrar como está hoje (com prints e um vídeo curto) e no final dizer exatamente onde eu preciso de vocês.

## O problema

Equipe pequena que toca vários microSaaS acaba com o trabalho espalhado: tarefa num lugar, conversa em outro, chamada em um terceiro, arquivo em um quarto. E tudo isso passa por servidores de terceiros, que enxergam cada mensagem, cada anexo, cada nome de projeto.

Eu fiquei me perguntando: e se fosse uma ferramenta só, pequena, que você sobe no seu próprio servidor e que **o servidor não consegue ler**?

Daí nasceu o **Crewstead**.

## O que é

Uma ferramenta web de colaboração para equipes pequenas, com:

- **Quadro de atividades** com épicos, subtarefas, responsáveis, prazos e colunas que você configura;
- **Sprints da equipe**, que podem juntar atividades de projetos diferentes;
- **Canais por projeto e mensagens diretas**, com menções, reações e respostas;
- **Chamadas de áudio, vídeo e tela** para até 5 pessoas (LiveKit, também self-hosted);
- **Anexos de até 500 MB**, enviados direto do navegador para um bucket compatível com S3 (R2 em produção, MinIO local);
- **Colaboradores externos** com acesso só aos projetos liberados;
- Dois personagenzinhos em pixel art, o Capuz e a Tela, que aparecem nos estados vazios e comemoram quando você entrega algo. Sem pontos, sem ranking, sem competição. Só uma comemoração discreta.

O slogan é "Pequenos passos. Grandes entregas.", e é basicamente o espírito do projeto.

![Quadro de atividades do Crewstead](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/img/02-quadro.png)

## O ponto central: auto-custódia de verdade

Essa é a parte que me move, então vou ser direto.

O conteúdo de trabalho (título e descrição das atividades, comentários, mensagens, nomes de projetos, canais e sprints, arquivos) é **cifrado no navegador, antes de sair dele**. O servidor guarda só texto cifrado. As chaves são geradas e ficam no seu dispositivo (libsodium, rodando em workers). Você continua entrando só com a senha da conta, não tem uma segunda senha para decorar.

Eu não quero que você acredite em mim, então vou mostrar. Isto é o que o banco de dados da instância de demonstração tem guardado das mensagens e das atividades que aparecem nos prints:

```
 title |                     title_enc                     | priority | encrypted
-------+---------------------------------------------------+----------+-----------
       | 0101000000018aed03c64f702e24790ca534c698c6ec67ec… | high     | t
       | 010100000001a38d170888a6df54fa1770c59c8e25a6c387… | normal   | t
       | 01010000000128d7982bbc3c6e2bca1974fd8dbc6ec4c10d… | normal   | t
       | 010100000001abf29e9cd8ac3fcc86534bba91fee4dbff49… | urgent   | t

 seq | body |                     body_enc                      | encrypted
-----+------+---------------------------------------------------+-----------
   1 |      | 010100000001fac0bb81c955593460f9bad86fb4cf037c78… | t
   2 |      | 010100000001df62a7f0ef0873a30b837a7b7ea20e4fa3d7… | t
```

Colunas `title` e `body` vazias. O que existe é `title_enc` e `body_enc`. Até a busca (o Ctrl K) roda local no navegador: a própria paleta avisa "busca local, nada vai ao servidor".

![Paleta de busca local](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/img/06-paleta.png)

### O que o servidor ainda enxerga (sem enrolação)

Segurança que esconde as próprias limitações não é segurança. Então:

- O servidor **vê metadados operacionais**: seu e-mail, o nome de perfil, a prioridade de cada atividade (repare na coluna `priority` aí em cima), datas, quem está em qual projeto, tamanho dos arquivos.
- Existe um **administrador de recuperação**. Ele pode decifrar conteúdo, inclusive mensagens diretas. Isso é uma decisão consciente: sem isso, perder o dispositivo significaria perder o histórico. A ação é explícita, local e auditada, e a própria tela avisa que o produto não é privado contra esse papel. A chave dessa identidade fica fora do servidor, num backup protegido por um segredo forte que você guarda longe da VPS.
- Se todos os dispositivos **e** o segredo de recuperação se perderem, o histórico pode ficar irrecuperável. Não tem chave-mestra escondida.
- Reset de senha sozinho **não** devolve as chaves do histórico. Um dispositivo novo precisa ser autorizado criptograficamente.

![Tela de recuperação, com o aviso explícito sobre o administrador](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/img/08-recuperacao.png)

Tudo isso está escrito em uma spec e em ADRs (registros de decisão) no repositório, não só na minha cabeça.

## Como ficou na prática

Segue um vídeo curto (em loop) com um fluxo real: abrir uma atividade, comentar, concluir (o Capuz aparece), ver a sprint andar e mandar uma mensagem. Tudo isso cifrando por baixo.

![Fluxo de concluir uma atividade](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/demo.gif)

Versão em vídeo completa (45 s): [demo.mp4](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/demo.mp4)

A atividade aberta, com subtarefas, comentários e o selo de que é cifrada ponta a ponta:

![Atividade aberta](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/img/03-atividade.png)

A sprint, juntando atividades do time:

![Sprint ativa](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/img/04-sprint.png)

Canal do projeto:

![Canal de mensagens](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/img/05-chat.png)

Tem tema escuro e funciona no celular (barra inferior em vez da lateral). Teclado, foco, contraste e a opção de reduzir animações foram tratados desde o começo, e arrastar cartão não é o único jeito de mover uma atividade: o menu do cartão também move.

![Tema escuro](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/img/10-quadro-escuro.png)

![Versão mobile](https://raw.githubusercontent.com/GuilhermeVgl/oddkin-comms/main/docs/article/img/11-mobile.png)

## Por baixo do capô

- **Backend:** Go, `net/http`, um monólito modular. Um único processo faz HTTP, migrations, bootstrap do administrador e os jobs.
- **Banco:** PostgreSQL com pgx e sqlc. Jobs com River, usando o próprio Postgres (sem Redis, sem broker).
- **Contrato:** OpenAPI 3.0.3, com código Go e cliente TypeScript gerados. Eventos em tempo real por WebSocket; escrita sempre por REST.
- **Frontend:** React, TypeScript strict, Vite, Tailwind, Radix, TanStack Query.
- **Chamadas:** LiveKit self-hosted, com a mídia também cifrada ponta a ponta.
- **Operação:** `make start` e pronto. Docker Compose com cinco serviços: `postgres`, `api`, `livekit`, `storage` e `web`.

Foi uma escolha deliberada ficar pequeno: nada de microsserviços, Kubernetes ou ORM extra. A ideia é que uma pessoa consiga subir, entender e manter numa VPS barata.

## Onde o projeto realmente está

Quero ser honesto sobre o estado, porque é isso que ajuda quem vai opinar:

- Os fluxos principais funcionam: projetos, quadro, sprints, canais, DMs, comentários, anexos, chamadas, notificações, backup cifrado.
- O desenvolvimento é guiado por TDD e por uma lista de quality gates. Mas **a cobertura de testes do frontend ainda está em torno de 35%**, contra a meta de 80% que eu mesmo me impus. Está documentado num mapa de débito técnico no repositório, e é um dos lugares onde ajuda é bem-vinda.
- A tela de chamada foi refatorada e verificada por tipos, lint e testes, mas **não** numa chamada real com várias pessoas ainda.
- O envio e o download de arquivos de 500 MB, com a memória medida, também ainda não foram exercitados de ponta a ponta.
- **Não houve auditoria criptográfica externa.** Eu usei primitivas de bibliotecas mantidas e não inventei algoritmo, mas o formato dos envelopes e o diretório de chaves são um protocolo de segurança, e um build verde não prova que ele está certo. É exatamente o tipo de coisa que eu quero que gente mais experiente critique.
- A **licença** ainda não está definida. Vou escolher antes da primeira release pública.

## Como você pode ajudar

Dá para ajudar de formas bem diferentes, de acordo com o tempo que você tem:

1. **Dar uma estrela no repositório.** Parece pouco, mas é o que ajuda o projeto a ser encontrado.
2. **Me seguir no GitHub**, se quiser acompanhar a evolução.
3. **Ler a spec e os ADRs e criticar.** Principalmente a parte de criptografia e recuperação. Se você trabalha com segurança, a sua revisão vale ouro, e eu agradeço até o "isso aqui está errado".
4. **Subir na sua máquina** (`make start`) e me contar onde travou. Experiência de instalação é o que mais quebra em projeto self-hosted.
5. **Abrir issues** com sugestão de escopo, bug ou estranhamento na interface.
6. **Contribuir com código.** As regras estão no `CLAUDE.md` e na spec. Cobertura de testes do frontend é um ótimo começo.

E eu tenho algumas perguntas para vocês, nos comentários:

- Um administrador de recuperação explícito e auditado é um trade-off aceitável para uma equipe pequena, ou vocês prefeririam não ter essa capacidade e aceitar perder histórico?
- O que faria vocês largarem o que usam hoje (Slack, Linear, Discord, Notion...) e testarem uma coisa assim? E o que seria um impeditivo?
- Faltou alguma coisa que equipe de microSaaS usa todo dia?

Repositório: **https://github.com/GuilhermeVgl/oddkin-comms**

Se você chegou até aqui, obrigado de verdade. Qualquer feedback, até o duro, é bem-vindo.
