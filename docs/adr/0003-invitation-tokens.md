# ADR 0003 — Token de convite

Status: adotado para o primeiro bloco de identidade, 23/10/2026.

## Decisão

O token de convite contém 32 bytes gerados por `crypto/rand`, codificados como base64url sem padding. O servidor armazena o SHA-256 dos caracteres do token, nunca o token em claro. A validade é de sete dias; o instante de expiração é exclusivo. A verificação rejeita codificações inválidas e compara os hashes em tempo constante. Falha da fonte de aleatoriedade impede a emissão.

O horário de emissão é uma entrada explícita para permitir testes determinísticos. O registro persistido usará instante UTC no PostgreSQL; a apresentação no cliente seguirá o fuso da organização.

## Limites

Este ADR descreve a primitiva de token. A persistência e o consumo único dos convites da organização são descritos em [ADR 0004](./0004-organization-invitations.md). Ainda faltam comprovação de controle do e-mail, criação de conta, convite de projeto e respostas sem enumeração. Portanto, AC-01 continua aberto.
