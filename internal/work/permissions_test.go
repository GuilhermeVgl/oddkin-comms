package work

import "testing"

func TestInternalMembersHaveEveryPermission(t *testing.T) {
	access := Access{Kind: "internal"}
	for _, permission := range []string{WorkRead, WorkCreate, WorkEdit, WorkMove, WorkArchive, WorkComment, PlanningEdit, ChatRead, ChatSend} {
		if !access.Can(permission) {
			t.Fatalf("internal member must have %s", permission)
		}
	}
}

func TestExternalMembersOnlyHavePolicyPermissions(t *testing.T) {
	access := Access{Kind: "external", External: []string{WorkRead, WorkComment}}
	if !access.Can(WorkRead) || !access.Can(WorkComment) {
		t.Fatal("external member must have granted permissions")
	}
	if access.Can(WorkEdit) || access.Can(WorkMove) {
		t.Fatal("external member must not have ungranted permissions")
	}
}

func TestExternalManagerFlagDoesNotGrantPermissions(t *testing.T) {
	if (Access{Kind: "external", Manager: true}).Can(WorkRead) {
		t.Fatal("manager flag must not widen external policy")
	}
}

func TestValidatePolicyRejectsUnknownAndMissingDependencies(t *testing.T) {
	cases := map[string][]string{
		"unknown":                 {WorkRead, "work.delete"},
		"edit without read":       {WorkEdit},
		"move without read":       {WorkMove, WorkComment},
		"send without chat read":  {WorkRead, ChatSend},
		"upload without download": {FilesUpload},
		"start without join":      {CallsStart},
		"screen without join":     {CallsScreenShare},
	}
	for name, permissions := range cases {
		if _, err := ValidatePolicy(permissions); err == nil {
			t.Fatalf("%s: expected error", name)
		}
	}
}

func TestValidatePolicyNormalizesDuplicates(t *testing.T) {
	normalized, err := ValidatePolicy([]string{WorkRead, WorkEdit, WorkRead})
	if err != nil {
		t.Fatal(err)
	}
	if len(normalized) != 2 {
		t.Fatalf("normalized=%v", normalized)
	}
	if empty, err := ValidatePolicy(nil); err != nil || len(empty) != 0 {
		t.Fatalf("empty policy must be valid: %v %v", empty, err)
	}
}

func TestValidatePolicyAllowsChatOnlyProfiles(t *testing.T) {
	if _, err := ValidatePolicy([]string{ChatRead, ChatSend}); err != nil {
		t.Fatalf("chat-only profile must be valid: %v", err)
	}
}

func TestAccessPermissionsListWhatTheCallerMayDo(t *testing.T) {
	internal := Access{Kind: "internal"}.Permissions()
	if len(internal) != len(knownPermissions) {
		t.Fatalf("an internal member holds every permission, got %v", internal)
	}
	external := Access{Kind: "external", External: []string{WorkRead, ChatRead}}
	if got := external.Permissions(); len(got) != 2 || got[0] != ChatRead || got[1] != WorkRead {
		t.Fatalf("externals hold what the policy grants, sorted: %v", got)
	}
	// The returned list is a copy: callers cannot change the policy through it.
	external.Permissions()[0] = "x"
	if external.External[0] != WorkRead {
		t.Fatal("Permissions must not alias the policy")
	}
}
