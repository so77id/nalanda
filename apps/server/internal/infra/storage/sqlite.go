// Package storage opens the SQLite database and brings its schema up to date.
//
// It is the only package that names a database driver. Everything above it
// receives a *sql.DB, which is what keeps the Postgres swap of ADR-0007 a
// localized change rather than a rewrite.
package storage

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"net/url"

	"github.com/pressly/goose/v3"

	// The pure-Go SQLite driver. No CGO, which is what lets the container be a
	// static binary on a scratch-class base image (ADR-0007).
	_ "modernc.org/sqlite"
)

// driverName is what modernc.org/sqlite registers itself as. Note it is
// "sqlite", not the "sqlite3" of the CGO driver — a mismatch here fails at
// runtime with "unknown driver", not at compile time.
const driverName = "sqlite"

// busyTimeoutMillis is how long a statement waits for a writer to finish before
// giving up with SQLITE_BUSY. SQLite serialises writes, so without this a
// second concurrent write fails immediately rather than queueing.
const busyTimeoutMillis = 5000

// Open connects to the SQLite database at path and proves the connection works.
//
// The round trip is the point. database/sql connects lazily, so sql.Open alone
// returns a healthy-looking handle for a path nothing can ever write, and the
// failure surfaces later at some unrelated call site.
func Open(ctx context.Context, path string) (*sql.DB, error) {
	db, err := sql.Open(driverName, dsn(path))
	if err != nil {
		return nil, fmt.Errorf("open the database at %s: %w", path, err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("reach the database at %s: %w", path, err)
	}
	return db, nil
}

// dsn builds the connection string, with the pragmas that have to be set per
// connection rather than once per database.
//
// WAL is the exception — it is written into the file header and persists — but
// it is set here anyway so that a database created by any path gets it, and
// because setting it on every connection is a no-op once it holds.
func dsn(path string) string {
	pragmas := url.Values{}
	pragmas.Add("_pragma", "journal_mode(WAL)")
	pragmas.Add("_pragma", fmt.Sprintf("busy_timeout(%d)", busyTimeoutMillis))
	// SQLite enforces foreign keys only when asked, per connection, and the
	// default is off. A schema whose references are documentation rather than
	// constraints is the thing this line prevents.
	pragmas.Add("_pragma", "foreign_keys(1)")

	return "file:" + path + "?" + pragmas.Encode()
}

// Migrate brings db up to the latest migration in fsys and reports how many it
// applied. A boot over an already-current database applies none and returns 0,
// which is what makes idempotence observable to a caller and to a test.
func Migrate(ctx context.Context, db *sql.DB, fsys fs.FS) (int, error) {
	// The provider API rather than goose's package-level functions: those keep
	// the filesystem and the dialect in global state, so two callers — or two
	// tests — configure each other.
	provider, err := goose.NewProvider(goose.DialectSQLite3, db, fsys)
	if err != nil {
		return 0, fmt.Errorf("prepare the migration set: %w", err)
	}

	results, err := provider.Up(ctx)
	if err != nil {
		return 0, fmt.Errorf("apply migrations: %w", err)
	}
	return len(results), nil
}
