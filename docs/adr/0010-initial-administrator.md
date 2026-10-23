# ADR 0010 — Instalação do primeiro administrador

Status: adotado para a fundação de identidade, 23/10/2026.

## Decisão

O comando `cmd/bootstrap` cria a organização única, a primeira conta interna e seu vínculo de administrador numa transação PostgreSQL. Um advisory lock transacional serializa tentativas concorrentes; depois da primeira instalação, novas execuções encerram com sucesso sem alterar contas ou senha. E-mail, senha e timezone são validados antes da transação, e nenhum desses valores é registrado em log.

O Compose local executa o bootstrap entre as migrations e a API. Para que `docker compose up -d` produza uma instalação utilizável sem etapa manual, a configuração de desenvolvimento tem credenciais conhecidas, substituíveis por `ODDKIN_ADMIN_EMAIL`, `ODDKIN_ADMIN_PASSWORD` e `ODDKIN_TIMEZONE` antes do primeiro início. O serviço só roda na rede privada do Compose e a aplicação é publicada no loopback.

## Limites

As credenciais padrão servem apenas ao ambiente local. Uma implantação pública precisa fornecer uma senha própria por mecanismo de secrets e TLS antes de expor a aplicação. O comando não redefine senha nem promove contas em uma instalação existente. Recuperação e convites permanecem fluxos separados.
