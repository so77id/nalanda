package storage

import (
	"context"
	"database/sql"
	"time"
)

// probeTimeout bounds the health check's own query. Without it, a database
// wedged behind a lock turns /health into a request that hangs rather than one
// that reports a problem — and a health check that hangs is indistinguishable
// from a server that is gone.
const probeTimeout = 2 * time.Second

// Prober answers whether the database is still reachable. It satisfies
// health.Prober from internal/domain/health; the interface is declared there
// and implemented here, so the dependency arrow points inwards and the domain
// never imports a driver.
type Prober struct {
	db *sql.DB
}

// NewProber wraps db.
func NewProber(db *sql.DB) *Prober {
	return &Prober{db: db}
}

// Probe runs a trivial statement rather than calling Ping.
//
// The reasoning: database/sql's Ping is satisfied by a connection the pool
// already holds, and it is the driver that decides how much of a round trip
// that is. A SELECT is a statement SQLite has to execute, so it exercises
// strictly more of the path /health claims to be reporting on.
//
// **The suite does not pin this difference, and the choice is a judgement
// rather than a measurement.** Swapping this line for p.db.PingContext(ctx)
// leaves every test green (verified by mutation, #149 S4): the two cases here
// use an open database and a closed one, and Ping and SELECT agree on both.
// Telling them apart needs a database that is gone from underneath a live
// connection — on SQLite the open file descriptor keeps working after the file
// is unlinked, so the state is not reachable from a test. Whoever finds a way
// to reach it should write the case and delete this paragraph.
func (p *Prober) Probe(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	var one int
	return p.db.QueryRowContext(ctx, "SELECT 1").Scan(&one)
}
