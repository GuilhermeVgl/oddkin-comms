// Package work holds the project and activity authorization rules.
package work

import (
	"fmt"
	"slices"
)

const (
	WorkRead         = "work.read"
	WorkCreate       = "work.create"
	WorkEdit         = "work.edit"
	WorkMove         = "work.move"
	WorkArchive      = "work.archive"
	WorkComment      = "work.comment"
	PlanningEdit     = "planning.edit"
	ChatRead         = "chat.read"
	ChatSend         = "chat.send"
	DirectMessages   = "direct_messages.use"
	FilesUpload      = "files.upload"
	FilesDownload    = "files.download"
	CallsStart       = "calls.start"
	CallsJoin        = "calls.join"
	CallsScreenShare = "calls.screen_share"
)

var knownPermissions = []string{WorkRead, WorkCreate, WorkEdit, WorkMove, WorkArchive, WorkComment, PlanningEdit, ChatRead, ChatSend, DirectMessages, FilesUpload, FilesDownload, CallsStart, CallsJoin, CallsScreenShare}

// requires maps a permission to the one it depends on (SPEC 5.2).
var requires = map[string]string{
	WorkCreate: WorkRead, WorkEdit: WorkRead, WorkMove: WorkRead, WorkArchive: WorkRead,
	WorkComment: WorkRead, PlanningEdit: WorkRead, ChatSend: ChatRead, FilesUpload: FilesDownload, CallsStart: CallsJoin, CallsScreenShare: CallsJoin,
}

// Access is what an account may do inside one project.
type Access struct {
	Kind     string
	Manager  bool
	External []string
}

// Can reports whether the account holds permission. Internal members hold all
// work permissions; externals hold exactly what the project policy grants.
func (a Access) Can(permission string) bool {
	if a.Kind == "internal" {
		return slices.Contains(knownPermissions, permission)
	}
	return slices.Contains(a.External, permission)
}

// Permissions lists everything the account may do in the project, sorted.
// Internal members hold every permission; externals hold what the policy grants.
func (a Access) Permissions() []string {
	source := a.External
	if a.Kind == "internal" {
		source = knownPermissions
	}
	granted := slices.Clone(source)
	slices.Sort(granted)
	return granted
}

// ValidatePolicy returns the sorted, de-duplicated permission set or explains
// why the configuration is invalid.
func ValidatePolicy(permissions []string) ([]string, error) {
	normalized := make([]string, 0, len(permissions))
	for _, permission := range permissions {
		if !slices.Contains(knownPermissions, permission) {
			return nil, fmt.Errorf("unknown permission %q", permission)
		}
		if !slices.Contains(normalized, permission) {
			normalized = append(normalized, permission)
		}
	}
	slices.Sort(normalized)
	for _, permission := range normalized {
		if dependency, ok := requires[permission]; ok && !slices.Contains(normalized, dependency) {
			return nil, fmt.Errorf("%s requires %s", permission, dependency)
		}
	}
	return normalized, nil
}
