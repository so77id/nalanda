package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The four-homes rule, gated instead of described.
//
// `apps/server/CLAUDE.md` says a configuration variable is added in four places
// and that a test catches only the first. That was true, and it drifted inside
// the very PR that restated the rule in a new guide's checklist:
// NALANDA_SESSION_TTL reached two of the four, and only a review lens noticed
// (#150 review, DCO-4/DCO-10/DAC-5).
//
// A set that grows, maintained by prose in four files, is the shape
// `documentation.md` says to convert into an invariant. So this reads the other
// three homes as text — the same trick `example_test.go` already uses for
// `.env.example` — and the rule can now say a test catches all four.
//
// It reads rather than parses on purpose: a YAML or workflow parser would be a
// dependency, and what is being asserted is only that the name APPEARS in the
// file an operator edits.

// otherHomes are the three homes outside this package, relative to it.
func otherHomes() map[string]string {
	// internal/infra/config -> apps/server -> the repo root.
	return map[string]string{
		"infra/local/docker-compose.yml": filepath.Join("..", "..", "..", "..", "..", "infra", "local", "docker-compose.yml"),
		".github/workflows/server.yml":   filepath.Join("..", "..", "..", "..", "..", ".github", "workflows", "server.yml"),
		"apps/server/README.md":          filepath.Join("..", "..", "..", "README.md"),
	}
}

func TestEveryVariableReachesAllFourHomes(t *testing.T) {
	keys := config.Keys()
	if len(keys) == 0 {
		t.Fatal("config.Keys() is empty, so this test verified nothing")
	}

	for name, path := range otherHomes() {
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("reading %s at %s: %v — it is one of the four homes, not optional", name, path, err)
		}
		text := string(contents)

		for _, key := range keys {
			if !strings.Contains(text, key) {
				t.Errorf("%s does not mention %s.\n"+
					"A configuration variable lives in FOUR homes (apps/server/CLAUDE.md): .env.example, "+
					"infra/local/docker-compose.yml, .github/workflows/server.yml and README.md §Configuration. "+
					"A required one missing from compose or CI makes the container refuse to start, and compose "+
					"sits outside CI's path filters — so nothing else sees it before a human runs the L8 step.",
					name, key)
			}
		}
	}
}
