package jobs

import (
	"os"
	"strings"
)

func appDisplayName() string {
	name := strings.TrimSpace(os.Getenv("APP_DISPLAY_NAME"))
	if name == "" || len(name) > 80 || strings.ContainsAny(name, "\r\n") {
		return "Crewstead"
	}
	return name
}
