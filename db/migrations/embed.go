package migrations

import "embed"

// FS contains application SQL migrations.
//
//go:embed *.sql
var FS embed.FS
