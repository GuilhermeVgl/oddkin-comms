package jobs

import "testing"

func TestRetentionDefaultsAndOverrides(t *testing.T) {
	if got := DefaultRetention(); got.CallDays != 30 || got.AuditDays != 180 {
		t.Fatalf("SPEC 15.4 defaults: %+v", got)
	}
	t.Setenv("RETENTION_AUDIT_DAYS", "365")
	got, err := RetentionFromEnv()
	if err != nil || got.AuditDays != 365 || got.CallDays != 30 {
		t.Fatalf("override: %+v %v", got, err)
	}
	t.Setenv("RETENTION_CALL_DAYS", "0")
	if _, err := RetentionFromEnv(); err == nil {
		t.Fatal("zero days must be refused")
	}
}
