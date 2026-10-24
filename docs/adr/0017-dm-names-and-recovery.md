# ADR 0017: Chaves de DM e de sprint, nomes cifrados e recuperação administrativa

## Estado

Implementada e exercitada em navegador real com dois usuários (aprovação de dispositivo, histórico para um dispositivo novo, DM cifrada e restauração pela recuperação). Sem revisão criptográfica externa; vale o [ADR 0015](./0015-e2ee-key-directory.md).

## Domínios novos

- **DM**: um domínio por conversa, legível pelas duas pessoas; o conjunto autorizado é seus dispositivos ativos mais a identidade de recuperação. Qualquer participante cria o domínio e publica a geração 1. Se a outra pessoa ainda não tem dispositivo, ela só lê o que for publicado depois de ter um (o histórico chega por concessão ou recuperação).
- **Sprint**: um domínio por organização, legível por todos os membros internos. Externos que enxergam uma sprint por terem trabalho nela **não** conseguem ler o nome: veem um marcador.
- Os domínios existentes seguem as mesmas regras do ADR 0015 (geração N+1 completa, `rotation_required` ao revogar, `pending_keys` para novos leitores, sem texto claro depois da primeira geração).

## Nomes

Nome e descrição de projeto (domínio `work`), nome de canal (domínio `chat`) e nome e objetivo de sprint (domínio `sprint`) são envelopes presos ao registro (`pn:`, `cn:`, `sp:`). Projetos novos nascem cifrados quando a organização tem criptografia ativa; os existentes são cifrados na ativação do projeto, por um gestor. Quem não lê o domínio `work` (um externo sem `work.read`) não lê o nome do projeto.

Ficam em claro: as datas de sprint, a cor e o ícone do projeto, nomes de arquivos de anexos, e os campos operacionais já listados na SPEC 10.2.

## Recuperação administrativa

- A identidade de recuperação é um dispositivo `recovery` da conta do administrador, que recebe um envelope de toda geração. Só o navegador do administrador a tem desbloqueada, protegida pela senha do navegador (e pelo backup baixado).
- `GET /recovery/gaps` lista (domínio, geração, dispositivo) em que um dispositivo autorizado não tem a chave, `GET /key-domains/{id}/recovery-envelopes` devolve os envelopes endereçados à identidade de recuperação e `POST /key-domains/{id}/recovery-grants` aceita a nova selagem. O administrador abre localmente o envelope de recuperação, sela para o dispositivo e assina com seu dispositivo comum.
- O servidor exige conta administradora com identidade de recuperação ativa, confere assinatura e destino, grava cada concessão em `recovery_audit` (quem, para quem, domínio, geração, quando) e avisa a pessoa por notificação interna e evento. Não existe rota que devolva texto em claro.
- O caminho comum (um dispositivo desbloqueado de um leitor entrega o histórico) continua preferido; a recuperação serve para quando ninguém mais tem a chave.

## Limites

- Não há redefinição de senha nem "recuperar a conta por e-mail": a recuperação criptográfica pressupõe que a pessoa já consegue entrar e registrar um dispositivo novo.
- Trocar a identidade de recuperação (registrar outra e reencapsular antes de revogar a antiga) é possível pela API, mas não tem tela.
- O administrador de recuperação vê, por design, quais contas e domínios (inclusive DMs) aguardam chaves.
- Quem perde todos os dispositivos e também a senha do navegador e o backup do administrador não recupera o histórico: não há chave-mestra no servidor.
