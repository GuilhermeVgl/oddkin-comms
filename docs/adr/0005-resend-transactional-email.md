# ADR 0005 — Transporte de e-mail pela Resend

Status: adotado para o transporte inicial, 23/10/2026.

## Decisão

Convites, verificação e redefinição de senha serão enviados pela [API de envio da Resend](https://resend.com/docs/api-reference/emails/send-email), não por SMTP. O adaptador Go `internal/platform/resendmail` faz `POST https://api.resend.com/emails` com Bearer, `User-Agent`, JSON e texto simples. Não adicionamos SDK: o endpoint necessário é pequeno, e a biblioteca padrão permite manter explícitos timeout, validação e tratamento de erros. Testes exercitam o contrato contra um servidor HTTP local.

Cada intenção de envio deve fornecer uma chave de idempotência estável, de até 256 caracteres. O adaptador não faz retry automático; informa se uma resposta é recuperável. `429`, `5xx` e `409 concurrent_idempotent_requests` são recuperáveis; demais `4xx` exigem intervenção ou correção dos dados. Respostas malformadas após `2xx` são ambíguas e só podem ser tentadas novamente mantendo exatamente a mesma chave e payload. O corpo de erro do provedor não aparece em logs ou erros, pois pode conter endereço, token ou outros dados sensíveis. A [retenção de idempotência da Resend dura 24 horas](https://resend.com/docs/dashboard/emails/idempotency-keys); a aplicação ainda precisa de estado durável próprio para não duplicar envios tardios.

Configuração dos processos de envio: `RESEND_API_KEY` e `RESEND_FROM_EMAIL`, com domínio remetente verificado. A chave fica apenas no servidor. O cliente valida ambos ao ser construído, usa timeout de 10 segundos e não segue redirects. Testes não usam credenciais nem chamadas reais à Resend.

## Limites

O adaptador envia uma mensagem quando chamado. `cmd/email-smoke` permite ao operador disparar uma mensagem diagnóstica fixa para validar credenciais e remetente; nenhum endpoint, job ou serviço de identidade o chama ainda. A emissão de convites, o outbox transacional, a composição de mensagens de produto, a reconciliação de entrega e os webhooks ainda precisam ser implementados. Aceitação da API não significa entrega na caixa postal. Não declarar AC-01 concluído com este transporte isolado.
