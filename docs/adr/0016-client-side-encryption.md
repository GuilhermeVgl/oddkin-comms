# ADR 0016: Cifragem de conteúdo no cliente e migração dos dados em claro

## Estado

Implementada e verificada em um navegador real contra a API local e PostgreSQL. **Sem revisão criptográfica externa**: vale a ressalva do [ADR 0015](./0015-e2ee-key-directory.md). As chamadas usam E2EE de mídia no LiveKit.

## O que é cifrado

Títulos e descrições de atividades e subtarefas, títulos e descrições de épicos, comentários e mensagens de canal de projeto. Cada campo é um envelope do protocolo v1 com contexto `organização | domínio | recurso | autor | revisão`, onde o recurso é `wi:<id>:title|desc`, `ep:<id>:title|desc`, `wc:<id>` ou `msg:<clientMutationId>`. A revisão de conteúdo avança de 1 em 1 a cada reescrita; o cliente sempre reenvia todos os campos cifrados do registro com a mesma revisão.

## Servidor

- Atividades, épicos e comentários cifrados usam ID escolhido pelo cliente, porque o envelope é preso ao ID. Mensagens usam o `clientMutationId`.
- Cada escrita cifrada exige o domínio com geração publicada, estado diferente de `rotation_required`, envelope na geração atual, assinatura de um dispositivo ativo do próprio autor e a revisão seguinte; caso contrário responde 409 ou 400 com um código (`stale_generation`, `rotation_required`, `bad_envelope`, `bad_revision`, `domain_unavailable`, `encryption_required`).
- **Sem downgrade**: depois da primeira geração de um domínio, o servidor recusa texto em claro daquele tipo de conteúdo (409 `encryption_required`).
- Linhas migradas têm o texto em claro apagado na mesma instrução que grava o envelope; as tabelas têm restrições que impedem uma linha ter os dois.
- Mensagens apagadas perdem também o envelope.

## Cliente

- As chaves privadas do dispositivo são geradas no navegador e guardadas no IndexedDB **apenas cifradas** por uma senha própria (Argon2id, perfil moderado do libsodium, e XSalsa20-Poly1305), diferente da senha de login. Em memória só existem entre desbloquear e bloquear; o logout bloqueia. Se o IndexedDB não estiver disponível, a interface avisa que nada sobrevive ao recarregar.
- O administrador gera a raiz de confiança e a identidade de recuperação no próprio navegador, fixa a chave pública da raiz no servidor, ativa os dois dispositivos com certificados que ele mesmo assina e pode baixar um backup (somente material cifrado pela senha). Outros dispositivos conferem o fingerprint da raiz, digitando-o, e ficam pendentes até serem aprovados por fingerprint (pelo administrador, com a raiz, ou por outro dispositivo da mesma conta).
- Para ler, o cliente abre os envelopes endereçados ao seu dispositivo, verifica a cadeia de certificados do remetente até a raiz fixada e só então usa a chave. Assinante sem cadeia confiável ou envelope inválido aparecem como conteúdo não verificado, nunca como texto.
- Um dispositivo desbloqueado age como "steward" dos domínios já ativados: publica a nova geração depois de uma revogação e entrega o histórico a dispositivos novos. Ativar a criptografia num projeto é uma ação explícita (cria os domínios, publica a geração 1 e oferece cifrar o conteúdo antigo).
- A migração cifra atividades e épicos que a pessoa pode editar e os comentários e mensagens que ela mesma escreveu; o conteúdo antigo dos outros é migrado pelos autores quando abrirem o projeto desbloqueados. Enquanto isso, ele continua legível em claro e aparece como antigo.

## Limites conhecidos

- DMs, nomes de projeto, canal e sprint também são cifrados. O nome de um anexo novo é cifrado e assinado no navegador, vinculado ao ID do anexo e ao domínio do contexto. O corpo dos arquivos passou a ser cifrado pela [ADR 0019](./0019-encrypted-file-bodies.md); o MIME type continua fora.
- Os campos que o servidor precisa para funcionar (responsável, coluna, prioridade, prazo, relações, tamanhos) ficam visíveis ao backend, como na SPEC 10.2.
- O libsodium roda na thread principal, não em um worker.
- Apagar o texto em claro de uma linha migrada não apaga cópias já feitas em backups do banco anteriores à migração.
- Fica sem cobertura E2E automatizada em navegador (apenas testes unitários do cliente, integração do servidor e uma verificação manual).

## Recarregar a página (atualização)

- **Desbloqueio por aba.** Ao desbloquear, as chaves também ficam em `sessionStorage` da aba (marcado por padrão, com opção de desligar), para que F5 não peça a senha de novo. `sessionStorage` some ao fechar a aba, e bloquear, sair ou esquecer o navegador apagam. Um script na página já alcançaria as chaves em memória, então isto não amplia o alcance de um ataque de XSS; amplia o de quem tem acesso físico a uma aba aberta e desbloqueada, como já acontecia sem recarregar.
- **Ativação retomável.** A raiz de confiança só pode ser fixada uma vez no servidor, então perder a chave privada dela a meio da ativação trancaria a organização. Agora as chaves são gravadas (cifradas) **antes** de qualquer chamada ao servidor, com a marca `incomplete`; repetir a ativação com a mesma senha reaproveita a raiz, os dispositivos já registrados e conclui o que faltou.
- **Links de e-mail.** O token de convite ou de redefinição sai da barra de endereço ao ser lido, mas fica na aba até ser usado, para que F5 na tela do convite não o perca.

## Convite que já inclui o histórico (ou não)

Quem convida escolhe, na hora do convite, entre **incluir** o histórico cifrado ou **não incluir**. Nas duas escolhas a pessoa convidada nunca vê a tela de chave.

- **Incluir (`history_mode = auto`).** O navegador da administração (desbloqueado, com a raiz) gera um segredo de 32 bytes, guarda uma cópia local e o coloca no fragmento do link do e-mail junto com a impressão digital da raiz (`#…&k=<segredo>&rf=<impressão>`). O servidor só repassa o texto: ele o guarda selado e o apaga ao enviar o e-mail ou ao usar o convite. Ao aceitar, o navegador convidado confere a impressão digital contra a raiz do servidor, gera seu dispositivo, registra-o com uma **prova** do segredo (`crypto_auth` sobre as duas chaves públicas) e guarda as chaves protegidas por uma senha aleatória gravada ao lado (`autoPassphrase`), sem pedir nada. O navegador da administração, que recebe o evento `device.changed`, confere a prova com o segredo que guardou e aprova na hora; sem a prova, o dispositivo continua na fila de aprovação manual. As chaves do histórico chegam pelo steward de sempre quando a pessoa é adicionada ao projeto.
- **Não incluir (`none`).** Nenhum dispositivo é criado; a pessoa vê os projetos cifrados como conteúdo oculto, com um aviso e o botão "Pedir acesso", que muda a conta para `ask` (a tela de chave de sempre).
- **Padrão (`ask`).** Contas existentes e administradores seguem como antes.

Limites assumidos: (1) o segredo passa pelo servidor que monta o e-mail e pelo provedor de e-mail, então quem o interceptar **antes de o convite ser usado** pode registrar um dispositivo aprovável. É a mesma janela do token do convite, e por isso o segredo só vale com o convite aberto e uma única aprovação. (2) A liberação depende de o navegador de quem convidou estar aberto e desbloqueado. (3) A senha aleatória guardada ao lado protege contra uma olhada casual no armazenamento, não contra quem lê o armazenamento deste navegador; quem quiser uma senha de verdade pode registrar o navegador de novo pelo fluxo manual.

## Uma senha só (atualização)

A pessoa usa **apenas a senha da conta**. As chaves do navegador não têm mais uma senha própria: ficam guardadas aqui, envolvidas por um valor aleatório que mora ao lado delas (`autoPassphrase`), como os apps de mensagens que guardam a chave no próprio aparelho (o WhatsApp não pede senha; o Rocket.Chat pede uma "senha E2E" separada e é isso que se quer evitar).

- **Administração:** "Ativar criptografia" é um botão só. A chave da organização e a identidade de recuperação nascem no navegador. O que protege contra a perda do navegador é o **backup de recuperação**: um arquivo cifrado por uma chave de 25 caracteres mostrada **uma vez**, que a pessoa guarda fora do computador. Essa chave não é guardada em lugar nenhum.
- **Demais pessoas:** o convite com histórico já deixa tudo pronto; sem ele, "Pedir acesso" registra o navegador e a administração aprova. Não se digita senha nem impressão digital: o navegador fixa a chave da organização que viu pela primeira vez (e a mostra em Configurações para conferência). Isso troca a conferência manual por confiança no primeiro uso, e um servidor que servisse outra raiz **na primeira vez** enganaria aquele navegador.
- **Navegadores antigos** (com senha própria) pedem a senha **uma última vez**: ao acertar, tudo é reembrulhado sob o valor aleatório e a senha deixa de existir.
- **Um navegador por pessoa, por enquanto.** Outro dispositivo da mesma conta continua dependendo de aprovação (manual) e a sincronização entre dispositivos fica para depois. Perder o navegador sem backup significa pedir a restauração pela identidade de recuperação.

O que protege as chaves em repouso é a mesma coisa que protege o navegador: quem lê o armazenamento deste navegador lê as chaves. Isso é o mesmo modelo das chaves de aparelho de um app de mensagens, sem a camada extra de uma senha.
