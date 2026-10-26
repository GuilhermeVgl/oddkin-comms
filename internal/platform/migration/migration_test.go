package migration

import "testing"

func TestAdminFromEnvRequiresACompleteCrewsteadPair(t *testing.T) {
	t.Setenv("CREWSTEAD_ADMIN_EMAIL", "")
	t.Setenv("CREWSTEAD_ADMIN_PASSWORD", "")
	t.Setenv("CREWSTEAD_TIMEZONE", "")
	if admin, err := AdminFromEnv(); err != nil || admin != nil {
		t.Fatalf("empty configuration: admin=%v err=%v", admin, err)
	}
	t.Setenv("CREWSTEAD_ADMIN_EMAIL", "admin@example.test")
	if _, err := AdminFromEnv(); err == nil {
		t.Fatal("partial credentials accepted")
	}
	t.Setenv("CREWSTEAD_ADMIN_PASSWORD", "synthetic long password")
	t.Setenv("CREWSTEAD_TIMEZONE", "America/Campo_Grande")
	admin, err := AdminFromEnv()
	if err != nil || admin == nil || admin.Email != "admin@example.test" || admin.Password != "synthetic long password" || admin.Timezone != "America/Campo_Grande" {
		t.Fatalf("complete configuration: admin=%v err=%v", admin, err)
	}
}
