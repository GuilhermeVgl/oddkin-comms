package work

import (
	"slices"
	"time"
)

// Streaks counts runs of consecutive days on which something was finished.
// days are calendar dates (the time of day is ignored) in any order; today is
// the current date in the same calendar. The current run ends today, or
// yesterday while today is still open, so a streak is only lost after a whole
// day without finishing anything.
func Streaks(days []time.Time, today time.Time) (current, best int) {
	dates := make([]int, 0, len(days))
	for _, d := range days {
		dates = append(dates, int(d.Unix()/86400))
	}
	slices.Sort(dates)
	dates = slices.Compact(dates)
	if len(dates) == 0 {
		return 0, 0
	}
	run := 1
	best = 1
	for i := 1; i < len(dates); i++ {
		if dates[i] == dates[i-1]+1 {
			run++
		} else {
			run = 1
		}
		best = max(best, run)
	}
	// run now holds the length of the run that ends on the latest date.
	latest := dates[len(dates)-1]
	now := int(today.Unix() / 86400)
	if latest == now || latest == now-1 {
		current = run
	}
	return current, best
}
