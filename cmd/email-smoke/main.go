package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/platform/resendmail"
)

func main() {
	to := flag.String("to", "", "recipient address for a diagnostic email")
	flag.Parse()
	if *to == "" {
		fmt.Fprintln(os.Stderr, "-to is required")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, *to); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, to string) error {
	if os.Getenv("RESEND_API_KEY") == "" || os.Getenv("RESEND_FROM_EMAIL") == "" {
		return errors.New("RESEND_API_KEY and RESEND_FROM_EMAIL are required")
	}
	client, err := resendmail.New(os.Getenv("RESEND_API_KEY"), os.Getenv("RESEND_FROM_EMAIL"))
	if err != nil {
		return errors.New("invalid Resend configuration")
	}
	id, err := sendDiagnostic(ctx, to, client)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintln(os.Stdout, "Resend accepted diagnostic email:", id); err != nil {
		return errors.New("could not write diagnostic result")
	}
	return nil
}

type emailSender interface {
	Send(context.Context, resendmail.Message) (string, error)
}

func sendDiagnostic(ctx context.Context, to string, sender emailSender) (string, error) {
	address, err := identity.NormalizeEmail(to)
	if err != nil {
		return "", errors.New("invalid recipient address")
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", errors.New("could not generate diagnostic message ID")
	}
	id, err := sender.Send(ctx, resendmail.Message{
		To:             address,
		Subject:        "ODDKIN: teste de e-mail",
		Text:           "Este e-mail confirma que a integracao com a Resend aceitou um envio de teste.",
		IdempotencyKey: "email-smoke/" + hex.EncodeToString(random[:]),
	})
	if err != nil {
		return "", errors.New("resend did not accept the diagnostic email")
	}
	return id, nil
}
