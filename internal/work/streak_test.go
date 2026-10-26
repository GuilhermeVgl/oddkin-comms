package work

import (
	"testing"
	"time"
)

func day(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}

func TestStreaks(t *testing.T) {
	today := day("2026-10-26")
	cases := []struct {
		name          string
		days          []string
		current, best int
	}{
		{"nothing finished", nil, 0, 0},
		{"only today", []string{"2026-10-26"}, 1, 1},
		{"today and the two days before", []string{"2026-10-26", "2026-10-25", "2026-10-24"}, 3, 3},
		{"yesterday keeps the streak alive until today ends", []string{"2026-10-25", "2026-10-24"}, 2, 2},
		{"two days without finishing breaks it", []string{"2026-10-24", "2026-10-23"}, 0, 2},
		{"best run can be older than the current one", []string{"2026-10-26", "2026-10-20", "2026-10-19", "2026-10-18", "2026-10-17"}, 1, 4},
		{"unordered input and repeats are fine", []string{"2026-10-24", "2026-10-26", "2026-10-25", "2026-10-26"}, 3, 3},
	}
	for _, c := range cases {
		days := make([]time.Time, len(c.days))
		for i, value := range c.days {
			days[i] = day(value)
		}
		current, best := Streaks(days, today)
		if current != c.current || best != c.best {
			t.Errorf("%s: got %d/%d, want %d/%d", c.name, current, best, c.current, c.best)
		}
	}
}
