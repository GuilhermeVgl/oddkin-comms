package calls

import (
	"errors"
	"os"
)

// FromEnv reads LIVEKIT_URL, LIVEKIT_API_URL, LIVEKIT_API_KEY and
// LIVEKIT_API_SECRET. The zero Config means calls are disabled; setting only
// some of them is an error so a half-configured deployment fails loudly.
func FromEnv() (Config, error) {
	config := Config{
		URL: os.Getenv("LIVEKIT_URL"), APIURL: os.Getenv("LIVEKIT_API_URL"),
		APIKey: os.Getenv("LIVEKIT_API_KEY"), APISecret: os.Getenv("LIVEKIT_API_SECRET"),
	}
	set := 0
	for _, value := range []string{config.URL, config.APIURL, config.APIKey, config.APISecret} {
		if value != "" {
			set++
		}
	}
	switch set {
	case 0:
		return Config{}, nil
	case 4:
		return config, nil
	default:
		return Config{}, errors.New("LIVEKIT_URL, LIVEKIT_API_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required together")
	}
}
