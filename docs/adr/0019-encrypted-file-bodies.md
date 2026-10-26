# ADR 0019: Corpo dos arquivos cifrado de ponta a ponta

## Estado

Implementada no servidor e no cliente, com testes unitários do formato, do envio em partes e da decifragem em stream, e testes de integração do servidor. **Sem revisão criptográfica independente**; vale a ressalva do [ADR 0015](./0015-e2ee-key-directory.md). Completa o que a [ADR 0013](./0013-attachments-multipart.md) e a [ADR 0016](./0016-client-side-encryption.md) deixaram pendente: até aqui só o nome do anexo era cifrado.

## Problema

SPEC 10.3 e 11 pedem que o corpo de um arquivo de até 500 MB seja cifrado no navegador, sem nunca ficar inteiro na memória, e que a chave do arquivo **não** chegue a quem lê atividades mas não pode baixar arquivos (AC-21). O servidor só vê bytes cifrados.

## Decisão

### Domínio de chave `files`

- Novo tipo de domínio por projeto, `files`, ao lado de `work` e `chat`. Seus leitores são os membros com `files.download` (e a identidade de recuperação). Quem só lê atividades ou chat **nunca** recebe a chave: a regra é a mesma de rotação e de estado dos outros domínios (`pending_keys`, `rotation_required`), sem caso especial.
- Anexos de canal e de atividade usam o domínio `files` do projeto. Anexos de DM usam o domínio `dm` da conversa, cujos leitores já são as duas pessoas.
- Ativar a criptografia num projeto cria o domínio `files`. Em projetos já cifrados, um cliente interno desbloqueado o cria na próxima atualização. Enquanto o domínio não tem geração, o envio em claro continua aceito; **depois da geração 1 o servidor recusa corpo em claro** (409 `encryption_required`), como nos outros conteúdos.

### Chave por arquivo e formato do objeto

Cada arquivo tem uma chave aleatória de 32 bytes. Ela nunca sai do navegador em claro: vai dentro do manifesto, que é um **envelope de conteúdo** do protocolo v1 (XChaCha20-Poly1305 com a chave do domínio na geração atual, assinado pelo dispositivo de quem enviou). O objeto no bucket é:

```
"CSKF" | versão(1)=1 | manifesto (182 bytes) | registro 1 | registro 2 | … | registro N
```

- **Manifesto** (texto claro antes de cifrar, 72 bytes): chave do arquivo (32) | cabeçalho do secretstream (24) | tamanho original `u64` | tamanho do registro `u32` | total de registros `u32`. O contexto autenticado do envelope é `organização | domínio | at:<id>:manifest | autor | revisão 1`, o que prende o manifesto ao anexo, ao autor e ao domínio.
- **Registros**: `crypto_secretstream_xchacha20poly1305` com a chave do arquivo. O tamanho do registro em claro é 262.144 bytes (o último pode ser menor e leva a tag `FINAL`); cada um acrescenta 17 bytes. O AAD de todos os registros é o contexto `… | at:<id>:body | autor | 1`. O secretstream já detecta registro alterado, reordenado, repetido ou removido do meio; a tag `FINAL` e o total do manifesto detectam **truncamento** e **bytes a mais**; o tamanho original no manifesto detecta registro final cortado.
- A cifra do corpo é **independente do multipart de transporte**: o cliente produz o fluxo de bytes cifrados em sequência e o corta em partes de 8 MiB para o bucket. Retentar uma parte reenvia exatamente os mesmos bytes, mantidos em memória enquanto a parte está em trânsito (no máximo duas). Não há retomada depois de fechar a aba: cancela-se e começa-se outro objeto com outra chave (SPEC 11.1).
- O formato de transporte é fixo e **calculável**: tamanho cifrado `C = 187 + n + 17·⌈n/262144⌉`, onde `n` é o tamanho original. O servidor inverte a fórmula para obter `n`; um `C` que não corresponda a nenhum `n` entre 1 e 500.000.000 é recusado (500.000.000 passa e 500.000.001 recebe 413). O servidor continua sem poder provar a semântica do plaintext, só os limites físicos.

### Servidor

- `POST /uploads` ganha `bodyEncrypted`. Com o domínio de corpo já com geração, `bodyEncrypted` é obrigatório; sem geração, é proibido. `size` passa a ser o tamanho **cifrado**, a cota e as partes seguem sobre ele.
- `complete` junta as partes, confere o tamanho real e então **lê o início do objeto** (um GET com faixa de 187 bytes) para validar o manifesto como valida qualquer escrita cifrada: magic e versão, envelope na geração atual, domínio sem `rotation_required`, assinatura de um dispositivo ativo do próprio autor e contexto `at:<id>:manifest`. Objeto inválido é descartado e a reserva liberada. O anexo só aparece como pronto depois disso.
- O download continua a exigir `files.download` a cada pedido e devolve a URL assinada de 60 s. O servidor entrega os bytes cifrados e nada mais.
- Anexos antigos (corpo em claro) continuam baixáveis e aparecem como "sem cifra de corpo".

### Cliente planejado

- **Envio**: lê o arquivo em fatias de 256 KiB com `Blob.slice`, cifra cada uma e acumula em partes de 8 MiB, sem `arrayBuffer()` do arquivo inteiro. O uso de memória é limitado a duas partes mais uma fatia.
- **Download em stream**: lê o corpo da resposta como stream, reagrupa em registros, verifica o manifesto (assinatura do enviador contra a cadeia confiável, contexto, tamanhos e total de registros) antes de qualquer plaintext e grava incrementalmente. Destino: `showSaveFilePicker` quando existir; senão arquivo no OPFS entregue como `File` apoiado em disco; sem nenhum dos dois, o app avisa a limitação **antes** de começar. Nunca monta o arquivo em RAM.
- Falha de verificação (manifesto, registro ou truncamento) interrompe, apaga o que já foi escrito e mostra um erro recuperável; nunca entrega um arquivo parcial como válido.

## O que continua fora

- O tipo MIME e a prévia: o tipo fica `application/octet-stream` no servidor e o cliente usa a extensão do nome. Prévia de imagem gerada no cliente não foi feita.
- Revogação não apaga arquivos já baixados nem URLs já emitidas. Rotação protege **novos** arquivos; os antigos continuam legíveis por quem guardou a chave da geração em que foram feitos (SPEC 10.3).
- Escrever em disco com `showSaveFilePicker` exige Chromium; o caminho OPFS foi implementado mas não medido em celular.
- Os testes atuais cobrem a aritmética de tamanho e a validação do manifesto no servidor. Ainda faltam testes do fluxo completo no cliente, inclusive truncamento, reordenação e troca de anexo. **Não** foram medidos: envio e download reais de 500 MB com memória observada, CORS do R2 e navegadores móveis.
