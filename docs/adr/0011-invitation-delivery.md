# ADR 0011 — Entrega e aceite de convites

Status: adotado em 23/10/2026.

## Decisão

Somente o administrador interno da organização cria convites. A API normaliza o e-mail, revoga convites válidos anteriores para o mesmo destinatário e grava, na mesma transação PostgreSQL, o convite, a intenção de entrega e o job River. O token enviado ao destinatário é armazenado como hash para o aceite. A cópia temporária necessária ao worker é cifrada com AES-256-GCM e `INVITATION_DELIVERY_KEY`; o job contém apenas o ID do convite.

O worker abre a cópia cifrada, compõe uma mensagem sem conteúdo de trabalho e envia pela API da Resend com a chave `invitation/<id>`. Respostas permanentes marcam a entrega como falha; falhas recuperáveis preservam o estado pendente e usam os retries limitados do River. Depois do aceite, a cópia cifrada do token é destruída, mantendo apenas o hash e os metadados de auditoria.

O link coloca token e e-mail no fragmento da URL. Fragmentos não são enviados no request HTTP inicial; o frontend os lê e remove imediatamente do endereço visível. Conta nova define uma senha no aceite. Conta existente precisa estar autenticada com o mesmo e-mail. O update condicional do convite garante uso único inclusive sob concorrência.

## Desenvolvimento local

O serviço `resend` do Compose implementa apenas `POST /emails`, mantém no máximo cem mensagens em memória e apresenta a caixa local em `127.0.0.1:8025`. Ele usa credenciais sintéticas e não participa de implantações reais. `RESEND_API_URL` existe apenas para apontar o worker local a esse serviço; quando ausente, o cliente usa o endpoint HTTPS oficial da Resend.

## Limites

A chave de entrega protege tokens temporários no banco, mas não é chave de conteúdo E2EE. Ela deve vir de um secret da implantação, ser compartilhada somente entre API e worker e não ser reutilizada para outros dados. A caixa local perde as mensagens ao reiniciar. Webhooks de entrega e reenvio administrativo ainda não foram implementados.
