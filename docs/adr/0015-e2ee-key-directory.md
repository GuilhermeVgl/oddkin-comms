# ADR 0015: Diretório de chaves e envelopes E2EE (protocolo v1, em revisão)

## Estado

Proposta implementada **sem revisão criptográfica independente**. Existem o formato, o diretório e as regras do servidor; **nenhum conteúdo do produto é cifrado ainda** ([ADR 0012](./0012-work-and-chat-v1.md) continua valendo). Um build verde e os testes abaixo não são uma auditoria; este protocolo exige revisão própria antes de proteger dados reais (SPEC 10.4).

## Formato (packages/crypto, libsodium)

- Primitivas: XChaCha20-Poly1305 (IETF) para conteúdo pequeno, `crypto_box_seal` para entregar a chave de um domínio a um dispositivo, Ed25519 destacado para assinaturas. Nenhum algoritmo foi inventado; o que é novo é a composição.
- Todo campo assinado ou autenticado usa concatenação com prefixo de 32 bits de comprimento, o que elimina ambiguidades entre campos. Os rótulos `crewstead/v1/...` separam os usos de assinatura.
- **Envelope de conteúdo**: `versão(1) | suíte(1) | geração(u32) | nonce(24) | ciphertext+tag | assinatura(64)`. Contexto autenticado (AAD): organização, domínio, recurso, autor e revisão; o cabeçalho (versão, suíte, geração) também entra no AAD. A assinatura do dispositivo autor cobre cabeçalho, contexto e ciphertext e é verificada **antes** de decifrar. Trocar o registro, o projeto, a revisão ou a geração invalida a leitura. O nonce é aleatório de 192 bits.
- **Envelope de chave**: a chave do domínio é selada para a chave pública do dispositivo destinatário e assinada pelo dispositivo remetente sobre (destinatário, domínio, geração, bytes selados). O servidor não consegue reetiquetar o envelope para outro destino.
- **Certificado de dispositivo**: assinatura sobre (conta, dispositivo, chave de assinatura, chave de caixa) pela raiz de confiança ou por um dispositivo ativo da mesma conta.
- Os mesmos bytes canônicos são verificados em Go (`internal/keys`) e em TypeScript; `packages/crypto/vectors.json` contém vetores sintéticos usados pelos dois lados.

## Diretório e regras do servidor

- **Raiz de confiança**: chave pública Ed25519 fixada uma vez por um administrador; o servidor se recusa a substituí-la. Seu fingerprint deve ser conferido fora do banco e fixado no cliente. O servidor guarda só a chave pública.
- **Dispositivos**: nascem `pending` com chaves públicas geradas no cliente. Só se tornam `active` com um certificado que o servidor verifica: assinado pela raiz (apresentada por um administrador, para qualquer pessoa) ou por um dispositivo ativo da mesma conta (para novos dispositivos dela). O servidor não consegue ativar um dispositivo próprio, porque não possui a raiz nem chave de dispositivo.
- **Identidade de recuperação**: um dispositivo `recovery` do administrador, ativado pela raiz. Toda geração publicada precisa de um envelope para ele.
- **Domínios**: um por projeto e tipo (`work`, `chat`), com gerações numeradas. Publicar a geração N+1 exige o conjunto exato de dispositivos ativos dos leitores atuais mais a identidade de recuperação: envelope a mais ou duplicado → 400, faltando → 409, assinatura inválida ou signatário não ativo/não dono → 400/403. A decisão é atômica sob lock da linha do domínio.
- **Estado derivado**: o estado é recalculado após mudar membros, política de externos e dispositivos. Quem tem a chave atual e deixou de ser autorizado coloca o domínio em `rotation_required` (`writable=false` até uma nova geração); quem é autorizado e ainda não tem a chave deixa em `pending_keys` (continua gravável). Os clientes recebem `key-domain.changed` pelo feed.

## Não implementado (pendente antes de qualquer dado real)

- Uso no cliente: geração e armazenamento protegido das chaves em worker, desbloqueio, publicação das gerações, cifragem e decifragem do conteúdo existente e migração dos dados em claro.
- Rejeição, no servidor, de escritas de conteúdo com geração antiga ou em `rotation_required` (o gating existe só como estado e o campo `writable`; `keys.VerifyContentEnvelope` e `EnvelopeGeneration` estão prontos para isso).
- Domínios de DM, sprint, arquivos por destinatário e chamada, além do fluxo de recuperação (solicitação, aprovação e reembrulho) e da auditoria correspondente.
- Cifra incremental de arquivos (secretstream), E2EE de mídia no LiveKit e o armazenamento local cifrado de chaves privadas.
- Revisão externa do protocolo, política de rotação por tempo e análise de metadados.

## Riscos conhecidos

- Quem controla o JavaScript servido ao navegador controla as chaves (SPEC 10.1).
- Sealed boxes não autenticam o remetente: a assinatura do envelope é que o faz, e depende de o cliente validar a cadeia raiz → dispositivo → envelope contra um fingerprint fixado.
- Sem forward secrecy nem post-compromise security.
