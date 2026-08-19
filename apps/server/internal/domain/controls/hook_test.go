package controls_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// AC-8 half: the default hook exists, does nothing visible, and logs the
// event at INFO — the one observable behaviour a future integration
// replaces.
func TestNoopHookLogsInfo(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	hook := controls.NewNoopHook(log)

	if err := hook.Closed(context.Background(), "CTRL0001ABC0000000000000AA"); err != nil {
		t.Fatalf("Closed: %v", err)
	}
	got := buf.String()
	if !strings.Contains(got, "correction closed") {
		t.Errorf("log = %q, want a line for the closed correction", got)
	}
	// The LEVEL is part of the AC ("loguea INFO"), not only the message —
	// a mutation that quietly demoted or promoted the line would keep the
	// message assertion green.
	if !strings.Contains(got, "level=INFO") {
		t.Errorf("log = %q, want the line at level INFO", got)
	}
}
