# CLAUDE.md — Crewstead

Este arquivo orienta Claude e outros agentes que implementam ou revisam este repositório. Aplique estas regras ao código que você criar. Trabalhe em incrementos pequenos e verificáveis; não trate código que compila como funcionalidade concluída.

## 1. Fonte de verdade e estado do projeto

- Leia [SPEC.md](./SPEC.md) antes de alterar arquitetura ou comportamento. Use seus critérios de aceite como referência dos testes.
- A spec define o produto; este arquivo define como desenvolvê-lo. O README apresenta a ideia e o estado real de implementação.
- Instrução explícita atual do mantenedor prevalece sobre padrões propostos da spec. Atualize a documentação afetada junto com a mudança, sem substituir requisitos silenciosamente.
- Inspecione o repositório e seu estado Git antes de trabalhar. Preserve alterações existentes de outras pessoas.
- No início deste pacote há documentação, não uma aplicação pronta. Comandos, testes, migrations, workflows e ferramentas descritos aqui devem ser implementados no bootstrap. Nunca afirmar que já existem sem verificar.
- Não adicionar recursos apenas porque parecem úteis. O produto é uma ferramenta pequena de trabalho e comunicação, não uma plataforma genérica de gestão.

## 2. Stack obrigatória

| Parte | Tecnologia |
| --- | --- |
| API (com jobs) | Go, um módulo na raiz, `net/http`, monólito modular; um único processo roda HTTP, migrations, bootstrap do administrador e workers River |
| Banco | PostgreSQL, `pgx/v5`, `sqlc`, migrations SQL com Goose |
| Jobs | River open source, usando PostgreSQL e transações do app |
| Contrato HTTP | OpenAPI 3.0.3, `oapi-codegen`, cliente TypeScript gerado |
| Eventos | WebSocket padrão com `coder/websocket`; mutações por REST |
| Frontend | React, TypeScript strict, Vite, Tailwind, Radix, TanStack Query |
| Interação | Motion, dnd-kit, alternativa acessível ao arraste |
| Chamadas | LiveKit self-hosted; SDK Go no backend, JS/React no cliente |
| Arquivos | R2 privado, AWS SDK for Go v2, multipart direto do navegador |
| Criptografia do conteúdo | libsodium no navegador, em workers |
| Operação | Docker Compose com `postgres`, `api`, `livekit`, `storage` (MinIO simulando o R2) e `web`; sem Redis, worker, migrate, bootstrap ou simulador de e-mail (ADR 0018) |

Não introduzir outro backend Node, microserviços, Kubernetes, ORM adicional, broker ou framework de DI sem necessidade concreta e decisão documentada. Node/pnpm continuam necessários ao frontend e aos geradores que os utilizam; não ao runtime da API Go.

## 3. Fluxo de trabalho: TDD obrigatório

Para funcionalidade, correção ou mudança de comportamento:

1. Identifique a regra da spec e descreva o resultado observável esperado. Inclua falha de autorização, borda ou concorrência quando pertinente.
2. **Red:** escreva um teste que falha pelo comportamento ausente/errado. Execute-o e confirme o motivo. Erro de import, fixture quebrada ou banco desligado não comprova o Red funcional.
3. **Green:** implemente a menor solução correta que faz esse comportamento passar, preservando os testes anteriores.
4. **Refactor:** melhore clareza e estrutura com os testes verdes. Não acrescente abstrações para cenários hipotéticos.
5. Execute os gates pertinentes e depois o gate completo exigido para a mudança. Revise o diff, contratos, migrations e documentação.

Para bug, o primeiro teste reproduz o defeito antes da correção. Para concorrência, escreva um cenário que coordene as operações e valide a invariável; não dependa de sleeps arbitrários. Para refatoração de comportamento existente, acrescente testes de caracterização quando a cobertura atual não sustenta a mudança.

Não é necessário escrever teste de comportamento para correção ortográfica, documentação ou mudança puramente estética sem regra nova. Valide links, layout e acessibilidade conforme o caso. Protótipos exploratórios podem anteceder testes, mas não entram na implementação final como exceção permanente: extraia contratos, testes e código de produção antes de integrar.

Nunca escrever testes que apenas reproduzem a implementação, testar getters triviais para inflar cobertura, alterar expectativa para acomodar um bug, desabilitar um teste falho ou esconder falha com retry ilimitado. Se um requisito está incorreto, explique o conflito e altere o requisito de forma explícita.

## 4. Estrutura e regras Go

- `cmd/api` e `cmd/migrate` contêm inicialização e composição, não regras de negócio.
- Domínio fica em `internal/<dominio>`; HTTP, SQL e integrações são adaptadores. Defina interfaces pequenas onde são consumidas, quando necessárias para isolamento/teste.
- Use nomes idiomáticos Go, `gofmt`, construtores explícitos e retorno de erros. Evite pacote genérico `utils`, singleton mutável, reflection desnecessária e interfaces para cada struct sem motivo.
- Propague `context.Context` a todas as operações de I/O. Respeite cancelamento, deadlines, encerramento e liberação de recursos.
- Toda goroutine tem escopo, dono e caminho de término. Canais e filas são limitados. Não há jobs confiáveis em goroutines soltas.
- Não use `time.Sleep` como sincronização de teste nem `context.Background()` para ignorar cancelamento de request. Um contexto de worker pode vir do lifecycle do processo, não de uma requisição já encerrada.
- Feche bodies, rows e recursos; cheque erros de iteração/commit. Trate rollback seguro e erros de contexto. Não ignore erro com `_` sem justificativa localizada.
- Use `errors.Is/As` para classificar erros e `%w` para wrapping. Não encaminhe mensagens internas do driver ao cliente.
- Evite `panic` em regras de negócio. Middleware de recovery é proteção de borda, não mecanismo normal de controle.
- Não use `unsafe`, CGO ou FFI para acelerar algo que não foi medido. O SDK de administração LiveKit não exige implementar processamento de mídia no app.
- Valide DTOs na entrada; não exponha structs SQL diretamente na API. Tipos estáticos não validam JSON recebido em runtime.
- Use `crypto/rand` para material aleatório de segurança; nunca `math/rand`. Defina limites de parâmetros de hash para evitar custo controlado pelo cliente.
- Faça logs estruturados com campos permitidos; nunca logue requests completos, objetos arbitrários ou segredos.

## 5. PostgreSQL, migrations e jobs

- Queries parametrizadas em `db/queries`; gere código com sqlc. Não edite `internal/store/sqlc` manualmente.
- Persistência deve usar PostgreSQL real em testes de integração. SQLite e mock de driver não comprovam locks, constraints, SQL e isolamento PostgreSQL.
- Uma operação atômica usa a mesma `pgx.Tx` em todos os repositórios, no outbox e no enqueue River. Não abra transação oculta dentro de um repositório já transacionado.
- Mutação + outbox + chave de idempotência devem confirmar ou reverter juntos. Jobs externos são idempotentes e limitados por timeout/retry.
- Não chame a API da Resend, R2 ou LiveKit mantendo lock do banco. Modele intenção, efeito externo e reconciliação para as falhas entre etapas.
- Mantenha constraints de integridade mesmo quando o serviço valida a mesma regra. Mutex Go não substitui lock transacional em admissão de chamadas, fechamento de sprint ou quota.
- Migrations já aplicadas são imutáveis. Alterar schema com nova migration e testar banco vazio e upgrade. Mudanças destrutivas requerem plano de dados e autorização concreta; não aplicar contra produção por conveniência.
- As migrations (aplicação e River, nessa ordem) rodam no início da API sob lock consultivo, salvo `AUTO_MIGRATE=false`; `cmd/migrate` executa o mesmo código à mão. Decisão do mantenedor para uma instalação pequena, em ADR 0018.
- Não depender de recursos River Pro para satisfazer requisitos do projeto open source.

## 6. Contratos, eventos e frontend

- OpenAPI e schemas de eventos são fonte única. Gere Go/TypeScript e valide fixtures cruzadas. Nunca manter DTOs equivalentes manualmente em duas linguagens.
- Código gerado deve conter marcador e ser reproduzível. Atualize a fonte, gere e revise o diff. Commitar código gerado é obrigatório neste projeto; CI verifica drift.
- Documente significado de `null`, campo ausente, base64, datas, timezone e IDs. Inteiros acima de `Number.MAX_SAFE_INTEGER` não atravessam JSON como número JS.
- WebSocket é entrega de eventos/referências e controle; escrita de negócio usa REST. Não reinvente RPC pelo socket.
- Implemente cursor por usuário, backpressure, reconexão, heartbeat, snapshot e deduplicação conforme a spec. Uma conexão autenticada pode perder permissão enquanto permanece aberta.
- Não permita que o cliente escolha subscriptions arbitrárias por ID. Valide autorização antes de enviar inclusive eventos cifrados.
- React não armazena segredos em URLs, telemetry, Redux/devtools ou logs. Separe cliente de API, criptografia e componentes de apresentação.
- TypeScript strict; não usar `any`, `@ts-ignore`, `eslint-disable` ou cast duplo para ocultar erro. Exceções pontuais precisam de motivo técnico, escopo mínimo e teste quando aplicável.
- Toda interação tem estados de loading, vazio, erro e retomada. Não apresentar sucesso antes de commit confirmado.
- Verifique teclado, foco, contraste, viewport mobile e redução de movimento. Arraste não pode ser o único meio de mover atividade.

## 7. Invariantes de segurança e produto

Estas regras precisam de testes positivos e negativos:

1. Usuário acessa somente projetos autorizados; IDs conhecidos, busca, totais, eventos, anexos e cursor não contornam isolamento.
2. Todos os externos de um projeto usam a mesma política granular; não criar overrides individuais.
3. Conteúdo do trabalho e arquivos são E2EE; backend só recebe ciphertext e metadados operacionais definidos na spec.
4. Chaves privadas de conteúdo/recuperação não ficam em secrets de servidor, logs, JWTs ou URLs.
5. Reset de senha não recupera por si só chaves do histórico. Dispositivo precisa de autorização criptográfica.
6. Administração de recuperação é explicitamente confiável; não alegar privacidade contra quem tem essa capacidade.
7. Uma chamada nunca admite seis pessoas, inclusive sob corrida, retry e múltiplos dispositivos. Há validação transacional e restrição no LiveKit.
8. Perda de E2EE não causa downgrade silencioso. Suspender fluxo e mostrar erro recuperável.
9. Upload de 500 MB é incremental, direto ao R2 e com limites físicos/criptográficos. Nunca carregar o arquivo inteiro no backend ou `arrayBuffer()` integral no navegador.
10. Revogação bloqueia novos acessos e gera rotação; não prometer apagar cópias já baixadas. Novas escritas aguardam chave atual válida.
11. Idempotência e replay não reentregam resultado a quem perdeu permissão. Um cursor não serve a outra conta.
12. Reconexão e retries não duplicam mensagens, notificações, chamadas ou efeitos de job.

Use primitivas de bibliotecas mantidas; não invente algoritmo criptográfico. O formato de envelopes e o diretório de chaves são protocolo de segurança e precisam de revisão própria, fixtures, vetores e testes negativos. Um build verde não é uma auditoria criptográfica.

Segredos de teste são sintéticos e rotulados. Nunca usar conta, chave, arquivo privado ou banco real em fixtures. Não desabilitar TLS, CSRF, autenticação, verificação de assinatura ou checagem de Origin para fazer um teste passar.

## 8. Quality gates a implementar

Criar um Makefile na raiz como interface única para desenvolvedores e CI. Os alvos abaixo são um contrato obrigatório; ainda não existem apenas porque estão descritos aqui. Todos retornam status diferente de zero em falha. Pré-requisito ausente deve falhar com explicação, nunca virar sucesso/skip silencioso.

| Alvo | O que deve verificar |
| --- | --- |
| `make doctor` | Versões fixadas de Go, Node/pnpm, Docker e ferramentas; portas/configuração de teste |
| `make generate` | OpenAPI Go/TS, schemas de eventos e sqlc; sem alterar arquivos de runtime à mão |
| `make check-generated` | Geração limpa e comparação de todos os outputs, incluindo novos/untracked; não altera o checkout do usuário |
| `make fmt-check` | Go formatado e formatter JS/Markdown configurado; apenas checagem |
| `make lint` | `go vet ./...`, golangci-lint fixado, ESLint e typecheck TS; sem avisos novos ignorados |
| `make test-unit` | `go test -race -count=1 ./internal/...` e Vitest; integrações ficam sob tag própria |
| `make test-integration` | `go test -race -count=1 -tags=integration ./tests/integration/...`, PostgreSQL real e integrações locais necessárias |
| `make test-e2e` | Playwright contra app/container reais, usuários isolados, navegadores baseline e artefatos de falha |
| `make coverage-check` | Cobertura de código escrito à mão, limiares abaixo, sem esconder pacotes novos |
| `make security-check` | `govulncheck ./...`, auditoria de dependências JS, secret scan e verificação de dependências/imagens conforme política |
| `make build` | Compilar API, migrate e frontend com toolchains fixadas |
| `make container-check` | Validar Compose com configuração de teste, build de imagens, migrations e smoke test/healthcheck |
| `make commit-check` | Validar mensagens dos commits novos e bloquear trailer de coautoria |
| `make gate-docs` | Markdown, links relativos/âncoras, ausência de segredos e política de commits; para mudança exclusivamente documental |
| `make gate` | Agregar geração, formato, lint, unitários, integração, E2E, cobertura, segurança, build e containers; incluir commit-check quando existir intervalo de commits |

`make check-generated` deve usar diretório temporário ou comparação explícita que detecte também arquivos não rastreados; `git diff` sozinho pode ignorá-los. Não executar comandos que apaguem mudanças locais. Toolchains e geradores fixados, sem dependência de versão global casual.

Antes do primeiro módulo, criar os alvos com implementações reais e testes do gate. Não criar targets que só fazem `echo OK`, `exit 0` ou aceitam ausência do teste como aprovação. Durante bootstrap incremental, reportar quais gates ainda não existem; não chamar o repositório de pronto até o gate completo funcionar.

### 8.1 Cobertura e qualidade dos testes

- Go: pelo menos 80% de statements do código escrito à mão da aplicação. Frontend: pelo menos 80% de statements e branches do código escrito à mão, medidos separadamente.
- Políticas de autorização, admissão de chamada, idempotência e coordenação de chaves: ao menos 90% de statements nos pacotes correspondentes, além de todos os cenários negativos exigidos pela spec. Para lógica TS desses módulos, exigir também 90% de branches.
- Exclusões apenas para código gerado verificável, assets e entrypoints de composição sem lógica. Manter a lista explícita, pequena e revisada. Não excluir arquivos difíceis, pacotes inteiros de negócio ou linhas novas para atingir o número.
- Tratar limiares como piso, não como substituto de testes. Cobertura não demonstra que E2EE ou controle de acesso estão corretos.
- CI Go deve reportar `-covermode=atomic` e arquivos de cobertura de unitários/integração sem somar percentuais; unir dados corretamente ou medir o conjunto em execução compatível.
- Testar corridas de verdade com transações concorrentes, barreiras e resultados observáveis. Ausência de data race Go não comprova ausência de corrida de negócio SQL.
- Mocks são adequados para falhas externas específicas; teste de integração confirma o contrato real onde importa. Não mockar todo o caminho que se pretende validar.
- Relógio e IDs podem ser injetados; aleatoriedade criptográfica usa gerador real em produção e fixtures controladas somente em teste.

### 8.2 CI e gates de release

Configurar CI de pull request com checks requeridos equivalentes a `make gate`. Usar ambiente Linux, PostgreSQL descartável, secrets de teste e versões fixadas. Workflows de forks não recebem segredos de produção; não executar código não confiável com `pull_request_target` e credenciais privilegiadas.

Fixar actions por commit verificado, permissões mínimas e dependências por lockfile. Scanners devem bloquear secrets e novas vulnerabilidades relevantes de alta/crítica severidade; qualquer exceção precisa de justificativa, dono e expiração explícitos. Não desligar scanner ou ampliar allowlist para mascarar alerta. O gate informa a diferença entre vulnerabilidade alcançável no runtime, dependência de build e falso positivo.

Testes caros de mídia em redes reais, arquivo de 500 MB, restauração e carga completa podem ficar em workflow separado/manual, mas são obrigatórios antes da primeira release e antes de mudanças que afetem esses caminhos. Anexar evidência e configuração do ambiente. Sem executá-los, não declarar esses requisitos validados.

Falha flaky precisa de diagnóstico. Um retry para coleta de evidência não transforma falha em sucesso automaticamente. Não marcar teste como ignorado sem decisão documentada e prazo; teste crítico não pode ser ignorado para liberar release.

## 9. Git e commits

- Faça commits apenas quando isso fizer parte da tarefa autorizada. Criar/editar arquivos não autoriza publicar, fazer push, merge ou release por conta própria.
- **Nunca criar commit com `Co-authored-by:`**, nem com qualquer variação de capitalização/espaçamento equivalente. Não incluir trailers de coautoria de Claude, outra IA, bots ou pessoas. Não inserir assinatura promocional do agente na mensagem.
- Não alterar a identidade Git global nem atribuir autoria a outra pessoa. Use a identidade configurada do repositório. Não remover avisos de copyright/atribuição necessários em arquivos ou dependências: a regra é sobre trailers de commit.
- Mensagens curtas e descritivas, preferencialmente Conventional Commits: `feat(work): support sprint rollover`, `fix(auth): reject revoked sessions`, `docs: clarify recovery flow`.
- Um commit representa uma mudança coerente. Não incluir arquivos de outras tarefas, secrets, `.env`, caches, dumps, binários, relatórios grandes ou `node_modules`.
- Antes de commitar código, execute `make gate` e revise `git diff --check`, diff e arquivos staged. Para documentação isolada, `make gate-docs` basta se já implementado; se ainda não existir, faça as verificações equivalentes e registre a limitação.
- Implemente hook `commit-msg` usando `core.hooksPath` local ao repositório, sem sobrescrever configuração existente silenciosamente. Hook deve rejeitar linha que corresponda, sem diferenciar caixa, a `^\s*co-authored-by\s*:`.
- CI verifica todas as mensagens do intervalo de commits novos da PR (`base..head`), não apenas HEAD. Validar também a mensagem preparada para squash/merge. Não varrer/reescrever histórico anterior de terceiros.
- `make commit-check` recebe base/head explícitos ou metadados confiáveis do CI. Range inexistente, Git indisponível ou falha ao ler mensagens é erro, não aprovação. No primeiro commit, o hook valida a mensagem proposta; após criado, CI valida o commit raiz.
- Nunca usar `--no-verify`, esconder falhas, rebaixar limiares ou mudar o teste para conseguir commitar. Se o gate não puder rodar, informe exatamente o bloqueio; não declare verde.
- Não usar `git reset --hard`, `git clean -fd`, force push, amend de commit publicado ou rebase destrutivo sem autorização explícita e necessidade concreta. Preserve trabalho de outras pessoas.

## 10. Open source e documentação

- README curto, correto e útil. Não adicionar badges de CI/cobertura que não correspondem a checks reais, número de usuários inventado ou recursos ainda não implementados apresentados como prontos.
- Licença ainda depende do mantenedor. Não adicionar licença MIT/Apache/GPL, ano/titular de copyright presumido, badge de licença ou autorização de uso de marca sem decisão explícita.
- Antes de release, incluir licença escolhida, regras de contribuição e canal real de relato de vulnerabilidades. Não inventar e-mail de segurança ou link de repositório.
- Código/identificadores e mensagens de commit preferencialmente em inglês; interface e documentação principal PT-BR nesta versão. Traduções futuras não mudam regras de negócio.
- Dados de exemplo inteiramente sintéticos. Assets precisam de origem e licença verificáveis; não copiar marca, ilustração ou fonte de terceiros sem os direitos necessários.
- Dependência nova exige motivo concreto, verificação de manutenção/licença e impacto no build/runtime. Evitar pacote que duplica biblioteca padrão sem benefício.
- Mudanças de API, schema, criptografia e deploy atualizam spec/ADRs e instruções de operação no mesmo conjunto de alterações.

## 11. Como terminar uma tarefa

Relate de forma curta:

1. O comportamento implementado e quais critérios AC cobre.
2. Arquivos ou módulos relevantes.
3. Testes/gates realmente executados e resultado; separar teste funcional de inspeção manual.
4. Limitações, testes não executados e o motivo, sem esconder pendência.
5. Necessidade de migration, mudança de configuração ou ação de operação.

Não dizer “pronto para produção”, “seguro” ou “testado” apenas porque o código compila ou a página abre. Não parar em um plano quando já há informação e autorização para implementar. Se uma decisão impede o trabalho, avance nas partes independentes e peça somente o esclarecimento necessário.
