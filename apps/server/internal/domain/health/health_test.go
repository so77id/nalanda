package health_test

import (
	"context"
	"errors"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/health"
)

// proberFunc adapts a function to health.Prober, so each case states its own
// database behaviour inline instead of through a struct nobody reads twice.
type proberFunc func(context.Context) error

func (f proberFunc) Probe(ctx context.Context) error { return f(ctx) }

func TestCheckReportsHealthyWhenTheDatabaseAnswers(t *testing.T) {
	reachable := proberFunc(func(context.Context) error { return nil })

	report := health.Check(context.Background(), reachable)

	if !report.Healthy() {
		t.Error("Healthy() = false, want true when the database answers")
	}
	if report.Database != health.StatusUp {
		t.Errorf("Database = %q, want %q", report.Database, health.StatusUp)
	}
}

// The whole point of the endpoint. A check that only proves the HTTP server
// accepted a connection lies exactly when it matters, so an unreachable
// database must make the report unhealthy rather than merely annotated.
func TestCheckIsUnhealthyWhenTheDatabaseDoesNotAnswer(t *testing.T) {
	unreachable := proberFunc(func(context.Context) error {
		return errors.New("no such file or directory")
	})

	report := health.Check(context.Background(), unreachable)

	if report.Healthy() {
		t.Error("Healthy() = true, want false when the database is unreachable")
	}
	if report.Database != health.StatusDown {
		t.Errorf("Database = %q, want %q", report.Database, health.StatusDown)
	}
}

// The reason travels with the report so an operator reading a non-200 learns
// what failed without opening the server's logs.
func TestCheckCarriesTheFailureReason(t *testing.T) {
	unreachable := proberFunc(func(context.Context) error {
		return errors.New("disk i/o error")
	})

	report := health.Check(context.Background(), unreachable)

	if report.Error == "" {
		t.Fatal("Error is empty on a failed check, want the cause")
	}
	if report.Error != "disk i/o error" {
		t.Errorf("Error = %q, want it to carry the prober's own message", report.Error)
	}
}

// A healthy report must not carry a stale reason: a field that is only
// sometimes cleared is how an operator ends up debugging last week's failure.
func TestCheckCarriesNoReasonWhenHealthy(t *testing.T) {
	report := health.Check(context.Background(), proberFunc(func(context.Context) error { return nil }))

	if report.Error != "" {
		t.Errorf("Error = %q on a healthy report, want it empty", report.Error)
	}
}

// The process half of the check is trivially true — the code is running — and
// it is asserted anyway, because the field is what makes a report readable as
// "the process is up AND the database is not".
func TestCheckAlwaysReportsTheProcessUp(t *testing.T) {
	for name, prober := range map[string]health.Prober{
		"database up":   proberFunc(func(context.Context) error { return nil }),
		"database down": proberFunc(func(context.Context) error { return errors.New("down") }),
	} {
		t.Run(name, func(t *testing.T) {
			if got := health.Check(context.Background(), prober).Process; got != health.StatusUp {
				t.Errorf("Process = %q, want %q", got, health.StatusUp)
			}
		})
	}
}
