// Package health answers one question: is this server able to do its job right
// now?
//
// It lives in the domain because the ANSWER is a policy decision — a server
// whose database is unreachable is not healthy, however well its HTTP listener
// is doing — and policy does not belong in a handler or in a driver. The
// package is pure: it imports nothing from internal/app or internal/infra, and
// it reaches the database only through the Prober interface below, which
// internal/infra/storage satisfies.
package health

import "context"

// Status is the state of one component of the server.
type Status string

const (
	StatusUp   Status = "up"
	StatusDown Status = "down"
)

// Prober is the database seen from the domain: something that can be asked
// whether it is still there. Declaring it here rather than in infra is what
// makes the dependency arrow point inwards — infra implements a domain
// interface, the domain never imports a driver.
type Prober interface {
	// Probe returns nil when the database answered.
	Probe(ctx context.Context) error
}

// Report is the result of one check, and the shape the endpoint serves.
type Report struct {
	// Process is up whenever this code runs at all. It is not redundant: it is
	// what makes a report readable as "the process is up AND the database is
	// not", which is a different operational situation from silence.
	Process Status `json:"process"`
	// Database is up when the Prober answered.
	Database Status `json:"database"`
	// Error carries the reason a component is down, so an operator reading a
	// non-200 learns what failed without opening the server's logs. Empty on a
	// healthy report — a field that is only sometimes cleared is how someone
	// ends up debugging last week's failure.
	Error string `json:"error,omitempty"`
}

// Healthy is true only when every component is up. The endpoint's status code
// is derived from this and from nothing else.
func (r Report) Healthy() bool {
	return r.Process == StatusUp && r.Database == StatusUp
}

// Check probes the database and reports what it found.
//
// The returned Report carries the raw cause in Error. Whether that reaches a
// caller is the SURFACE's decision, not this package's — see Report.Public.
func Check(ctx context.Context, database Prober) Report {
	report := Report{Process: StatusUp, Database: StatusUp}

	if err := database.Probe(ctx); err != nil {
		report.Database = StatusDown
		report.Error = err.Error()
	}
	return report
}

// Public is the same report with the diagnostic removed, for a surface whose
// callers are not operators.
//
// Today Error holds a SQLite message ("sql: database is closed") and there is
// nothing to leak. But `config.DatabaseURL` is documented as a future Postgres
// DSN, and pgx renders a connection failure as `failed to connect to host=…
// user=… database=…` — which the anonymous surface would then publish to any
// student's browser (#149 review, F2). The audiences differ here, so the
// surfaces differ here; that difference is also the first concrete thing
// `internal/app/api` exists to express.
func (r Report) Public() Report {
	r.Error = ""
	return r
}
