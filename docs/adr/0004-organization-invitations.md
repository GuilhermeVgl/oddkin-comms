# ADR 0004 — Persistência de convites da organização

Status: adotado para a fundação de identidade, 23/10/2026.

## Decisão

A migration `00002` cria convites da organização vinculados ao registro único da instalação. Cada convite guarda e-mail normalizado, vínculo interno/externo, hash SHA-256 do token, expiração, criação e consumo. Constraints PostgreSQL exigem hash de 32 bytes, e-mail em minúsculas sem espaços nas bordas, vínculo válido e hash único.

A query `ClaimOrganizationInvitation` usa o relógio do PostgreSQL e exige que o e-mail normalizado comprovado corresponda ao destinatário. Um `UPDATE ... WHERE consumed_at IS NULL AND expires_at > clock_timestamp()` faz com que apenas uma tentativa concorrente consuma o convite. A query deve ser executada na **mesma transação** que criará a conta ou vínculo, depois da comprovação do e-mail; um rollback preservará o convite. O parâmetro de e-mail não é prova de controle por si só: o serviço de aceite deverá obtê-lo de uma sessão autenticada ou verificação concluída, nunca do corpo livre da requisição. Nenhuma rota HTTP chama essa query neste incremento.

O destinatário passa por `identity.NormalizeEmail` antes de ser persistido: espaços nas bordas e diferença entre maiúsculas/minúsculas são eliminados; nomes de apresentação, listas, quebras de linha, endereços acima de 254 bytes e caracteres não ASCII são rejeitados. Não aplicamos regras específicas de provedor, como remover `+tag` ou pontos. O suporte a endereços internacionais depende de uma decisão posterior sobre SMTPUTF8 e normalização consistente entre Go, PostgreSQL e o provedor SMTP. A mesma função deverá ser usada para e-mail de conta e comparação no aceite.

O teste de integração cobre banco vazio, upgrade de `00001` com organização já persistida, destinatário divergente, expiração, duas tentativas simultâneas e e-mail não normalizado. A migration `00001` permanece inalterada.

## Limites

Convite de projeto, validação completa de endereço, comprovação do e-mail, envio SMTP, criação de conta, política de autorização e resposta sem enumeração ainda não existem. Esta migration não conclui AC-01. O administrador não deve usar `ClaimOrganizationInvitation` fora da transação de aceite. Downgrade que remove convites exige backup e plano de dados; `cmd/migrate` aplica apenas upgrades.
