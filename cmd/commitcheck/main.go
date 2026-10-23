package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/GuilhermeVgl/oddkin-comms/internal/commitcheck"
)

func main() {
	base := flag.String("base", "", "base commit or ref for a new-commit range")
	head := flag.String("head", "", "head commit or ref for a new-commit range")
	messageFile := flag.String("message-file", "", "prepared commit message file for commit-msg hook")
	flag.Parse()
	if flag.NArg() != 0 {
		fail(fmt.Errorf("unexpected positional arguments"))
	}
	var err error
	switch {
	case *messageFile != "" && *base == "" && *head == "":
		var message []byte
		message, err = os.ReadFile(*messageFile)
		if err == nil {
			err = commitcheck.CheckMessage(string(message))
		}
	case *messageFile == "" && *base != "" && *head != "":
		err = commitcheck.CheckRange(context.Background(), ".", *base, *head)
	default:
		err = fmt.Errorf("provide either -message-file or both -base and -head")
	}
	if err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "commit-check:", err)
	os.Exit(1)
}
