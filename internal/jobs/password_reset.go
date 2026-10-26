package jobs

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/platform/resendmail"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

type PasswordResetEmailArgs struct {
	ResetID string `json:"reset_id"`
}

func (PasswordResetEmailArgs) Kind() string { return "password_reset_email" }

func (PasswordResetEmailArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 10, Queue: "email"}
}

type passwordResetEmailWorker struct {
	river.WorkerDefaults[PasswordResetEmailArgs]
	pool        *pgxpool.Pool
	mailer      InvitationMailer
	deliveryKey []byte
	publicURL   string
}

func (worker *passwordResetEmailWorker) Timeout(*river.Job[PasswordResetEmailArgs]) time.Duration {
	return 15 * time.Second
}

// Work sends the link once. The e-mail carries no project, task or message content.
func (worker *passwordResetEmailWorker) Work(ctx context.Context, job *river.Job[PasswordResetEmailArgs]) error {
	var resetID pgtype.UUID
	if err := resetID.Scan(job.Args.ResetID); err != nil {
		return river.JobCancel(errors.New("invalid reset ID"))
	}
	queries := sqlc.New(worker.pool)
	delivery, err := queries.GetPasswordResetDelivery(ctx, resetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // used, expired or already sent
	}
	if err != nil {
		return fmt.Errorf("load password reset: %w", err)
	}
	token, err := identity.OpenResetToken(worker.deliveryKey, delivery.TokenCiphertext)
	if err != nil {
		return river.JobCancel(errors.New("invalid password reset delivery"))
	}
	link, err := resetLink(worker.publicURL, token)
	if err != nil {
		return river.JobCancel(errors.New("invalid reset public URL"))
	}
	if _, err = worker.mailer.Send(ctx, resendmail.Message{
		To: delivery.EmailNormalized, Subject: "Redefinir senha no " + appDisplayName(),
		Text: "Alguém pediu para redefinir a senha desta conta no " + appDisplayName() + ".\n\nAbra este link para escolher uma nova senha:\n" + link +
			"\n\nO link vale por uma hora e funciona uma única vez. Se não foi você, ignore este e-mail." +
			"\n\nRedefinir a senha não restaura o histórico cifrado: este dispositivo ainda precisa ser liberado depois.",
		IdempotencyKey: "password-reset/" + job.Args.ResetID,
	}); err != nil {
		var sendErr *resendmail.SendError
		if errors.As(err, &sendErr) && !sendErr.Retryable {
			return river.JobCancel(errors.New("permanent password reset delivery failure"))
		}
		return fmt.Errorf("send password reset email: %w", err)
	}
	if _, err = queries.MarkPasswordResetSent(ctx, resetID); err != nil {
		return fmt.Errorf("mark password reset sent: %w", err)
	}
	return nil
}

func resetLink(publicURL, token string) (string, error) {
	base, err := url.Parse(publicURL)
	if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Host == "" ||
		base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return "", errors.New("invalid public URL")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/"
	base.Fragment = "reset-password?" + url.Values{"token": {token}}.Encode()
	return base.String(), nil
}
