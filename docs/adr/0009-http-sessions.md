# ADR 0009 — Login e sessão HTTP

Status: adotado para a fundação de identidade, 23/10/2026.

## Decisão

O contrato OpenAPI expõe login, conta atual, logout e logout global. Login compara senha com Argon2id, usa uma comparação de custo equivalente quando o e-mail não existe e devolve a mesma resposta para credenciais incorretas. Requisições de escrita exigem Origin igual ao host e esquema recebidos; logout também exige o token CSRF enviado em `X-CSRF-Token`. O cookie de sessão é `Secure`, `HttpOnly`, `SameSite=Lax` e limitado ao caminho da API. O cookie CSRF é `Secure`, `SameSite=Lax` e legível pelo frontend. A API devolve apenas identificador e e-mail em `/me`, com `Cache-Control: no-store`.

Um limitador em memória registra falhas por endereço remoto e e-mail normalizado. Após cinco falhas para o mesmo e-mail, aplica esperas progressivas e limitadas; por endereço, o limiar é de cem falhas. Entradas antigas expiram e o mapa tem limite de tamanho. O limitador é apropriado para o Compose com uma instância de API; distribuição entre várias instâncias exigirá estado compartilhado e teste específico.

Testes de integração exercitam credenciais incorretas e conta inexistente, origem cruzada, cookies, `/me`, CSRF, logout, logout global e bloqueio por tentativas. Os handlers usam as queries sqlc e não devolvem mensagens internas do banco.

## Limites

Ainda não há instalação inicial, envio/aceite de convite ou tela de login; por isso o Compose sobe a API, mas não oferece uma conta pronta. A SPEC requer ainda redefinição de senha, verificação de e-mail, interface de dispositivos e limites de login distribuídos antes de considerar AC-01 e AC-02 concluídos. O Compose atual só publica HTTP no loopback para desenvolvimento; implantação pública precisa de TLS e configuração operacional própria.
