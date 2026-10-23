# ADR 0007 — Contas, vínculos e sessões

Status: adotado para a fundação de identidade, 23/10/2026.

## Decisão

A migration `00003` adiciona `account`, `organization_membership` e `auth_session`. A conta possui e-mail normalizado único, hash Argon2id e estado ativo. O vínculo registra o papel interno/externo e restringe a administração a internos. A sessão guarda somente hashes de token opaco e CSRF, expiração absoluta, última atividade e revogação. Hashes de sessão têm 32 bytes; a migration não guarda tokens em claro.

O aceite deve consumir o convite e criar conta e vínculo na mesma transação. O teste de integração faz uma tentativa revertida, confirma que o convite permanece válido, registra a conta e o vínculo numa segunda transação e comprova que o token não pode ser reutilizado. Também valida e-mail único, senha persistida verificável e constraints de sessão. A migration anterior permanece intacta e o teste de upgrade cobre as novas tabelas.

## Limites

Ainda não há fluxo HTTP de aceite, emissão de sessão, cookies, autenticação ou cadastro inicial do administrador. As tabelas e queries são a base para esses fluxos; a presença delas não conclui AC-01 ou AC-02. O token de convite não é prova de controle do e-mail quando obtido por outro canal; o fluxo de envio e aceite deverá aplicar a regra de comprovação da SPEC.
