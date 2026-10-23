# ADR 0006 — Hash de senhas

Status: adotado para a fundação de identidade, 23/10/2026.

## Decisão

O servidor deriva hashes de senha com Argon2id, sal aleatório de 16 bytes e chave de 32 bytes. O formato persistível inclui versão e custos: 19 MiB de memória, duas passagens e uma linha de execução. A entrada exige pelo menos 12 caracteres Unicode válidos e no máximo 1024 bytes. Frases longas e colagem são permitidas; não há regras de composição.

Na verificação, parâmetros guardados são analisados e limitados antes de chamar Argon2. A comparação do hash derivado usa tempo constante. O formato inclui os parâmetros para permitir aumento de custo futuro sem quebrar contas existentes; uma mudança de custo exige migração oportunista após login válido e medição no host de produção.

## Limites

Este componente ainda não cria contas, aceita convites, autentica requests nem limita tentativas de login. Senhas e hashes não entram em logs. A segurança do login completo depende também de sessão, CSRF, Origin, rate limit e revogação, previstos na SPEC.
