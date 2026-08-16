// Package migrations carries the SQL migration set into the binary.
//
// Embedded rather than read from disk so the container ships one static file
// and cannot start against a migration set that does not match the code that
// expects it (ADR-0007: the database is a file on a volume, the schema is not).
package migrations

import "embed"

// FS holds every migration, at the root of the filesystem, which is where the
// goose provider looks for them.
//
//go:embed *.sql
var FS embed.FS
