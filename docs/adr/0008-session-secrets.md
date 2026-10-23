# ADR 0008 — Segredos e ciclo de sessão

Status: adotado para a fundação de identidade, 23/10/2026.

## Decisão

Cada sessão usa dois segredos independentes de 32 bytes produzidos por `crypto/rand`: token opaco de autenticação e token CSRF. A aplicação armazena apenas hashes SHA-256, compara o hash CSRF em tempo constante e rejeita valores que não sejam base64url canônico de 32 bytes. A validade absoluta inicial é de sete dias e a expiração por inatividade é de 24 horas. A consulta PostgreSQL exige conta ativa, sessão não revogada e ambas as janelas vigentes, usando o relógio do banco. A atualização de atividade é limitada a uma vez por hora por sessão e não revive uma sessão inativa. Revogar sessão individual ou todas as sessões da conta é uma operação idempotente.

Testes unitários validam independência e formato dos segredos. Testes de integração exercitam emissão, consulta, expiração absoluta e por inatividade, desativação da conta e revogação no PostgreSQL real.

## Limites

As rotas de login, cookies `Secure`/`HttpOnly`/`SameSite=Lax`, verificação de Origin, proteção CSRF dos handlers, limitação de tentativas e interface de dispositivos ainda precisam ser implementadas. O suporte de persistência não representa um sistema de autenticação completo nem conclui AC-02.
