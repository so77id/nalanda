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
	if got := buf.String(); !strings.Contains(got, "correction closed") {
		t.Errorf("log = %q, want an INFO line for the closed correction", got)
	}
}
