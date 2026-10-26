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

type InvitationEmailArgs struct {
	InvitationID string `json:"invitation_id"`
}

func (InvitationEmailArgs) Kind() string { return "invitation_email" }

func (InvitationEmailArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 10, Queue: "email"}
}

type InvitationMailer interface {
	Send(context.Context, resendmail.Message) (string, error)
}

type invitationEmailWorker struct {
	river.WorkerDefaults[InvitationEmailArgs]
	pool        *pgxpool.Pool
	mailer      InvitationMailer
	deliveryKey []byte
	publicURL   string
}

func (worker *invitationEmailWorker) Timeout(*river.Job[InvitationEmailArgs]) time.Duration {
	return 15 * time.Second
}

func (worker *invitationEmailWorker) Work(ctx context.Context, job *river.Job[InvitationEmailArgs]) error {
	var invitationID pgtype.UUID
	if err := invitationID.Scan(job.Args.InvitationID); err != nil {
		return river.JobCancel(fmt.Errorf("invalid invitation ID"))
	}
	queries := sqlc.New(worker.pool)
	delivery, err := queries.GetInvitationDelivery(ctx, invitationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load invitation delivery: %w", err)
	}
	if delivery.State != "pending" {
		return nil
	}
	token, err := identity.OpenInvitationToken(worker.deliveryKey, delivery.TokenCiphertext)
	if err != nil {
		_, _ = queries.MarkInvitationDeliveryFailed(ctx, invitationID)
		return river.JobCancel(errors.New("invalid invitation delivery"))
	}
	link, err := invitationLink(worker.publicURL, delivery.EmailNormalized, token)
	if err != nil {
		_, _ = queries.MarkInvitationDeliveryFailed(ctx, invitationID)
		return river.JobCancel(errors.New("invalid invitation public URL"))
	}
	providerID, err := worker.mailer.Send(ctx, resendmail.Message{
		To: delivery.EmailNormalized, Subject: "Convite " + appDisplayName(),
		Text: "Você recebeu um convite para colaborar no " + appDisplayName() + ".\n\nAbra este link para aceitar:\n" + link +
			"\n\nEste convite expira em sete dias.",
		IdempotencyKey: "invitation/" + job.Args.InvitationID,
	})
	if err != nil {
		var sendErr *resendmail.SendError
		if errors.As(err, &sendErr) && !sendErr.Retryable {
			_, _ = queries.MarkInvitationDeliveryFailed(ctx, invitationID)
			return river.JobCancel(errors.New("permanent invitation delivery failure"))
		}
		return fmt.Errorf("send invitation email: %w", err)
	}
	rows, err := queries.MarkInvitationDeliverySent(ctx, sqlc.MarkInvitationDeliverySentParams{
		InvitationID: invitationID, ProviderID: pgtype.Text{String: providerID, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("mark invitation delivered: %w", err)
	}
	if rows == 0 {
		return nil
	}
	return nil
}

func invitationLink(publicURL, email, token string) (string, error) {
	base, err := url.Parse(publicURL)
	if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Host == "" ||
		base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return "", errors.New("invalid public URL")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/"
	values := url.Values{"email": {email}, "token": {token}}
	base.Fragment = "accept-invitation?" + values.Encode()
	return base.String(), nil
}
