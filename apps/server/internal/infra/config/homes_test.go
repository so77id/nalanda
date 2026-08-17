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
// dependency. But it does not merely search for the name — a key parked in a
// COMMENT satisfied the first version, which is the drift most likely to happen
// (someone comments a line out) and exactly what the failure message describes
// (#150 review, ARQ-15, and the verifier on DCO-4). A line has to DECLARE it:
// the key, then `:` or `=`, on a line that is not itself a comment.

// home is one of the three places outside this package.
//
// The two that are EXECUTED must declare the key — `KEY:` or `KEY=` on a line
// that is not a comment — because a commented-out line there is a container that
// refuses to start. The README is a markdown table, where the key is a cell and
// there is nothing to declare it with, so a mention is all that can be asked and
// all that is needed: its reader is a person, not a runtime.
type home struct {
	path      string
	declaring bool
}

// otherHomes are the three homes outside this package, relative to it.
func otherHomes() map[string]home {
	// internal/infra/config -> apps/server -> the repo root.
	root := filepath.Join("..", "..", "..", "..", "..")
	return map[string]home{
		"infra/local/docker-compose.yml": {filepath.Join(root, "infra", "local", "docker-compose.yml"), true},
		".github/workflows/server.yml":   {filepath.Join(root, ".github", "workflows", "server.yml"), true},
		"apps/server/README.md":          {filepath.Join("..", "..", "..", "README.md"), false},
	}
}

func TestEveryVariableReachesAllFourHomes(t *testing.T) {
	keys := config.Keys()
	if len(keys) == 0 {
		t.Fatal("config.Keys() is empty, so this test verified nothing")
	}

	for name, where := range otherHomes() {
		contents, err := os.ReadFile(where.path)
		if err != nil {
			t.Fatalf("reading %s at %s: %v — it is one of the four homes, not optional", name, where.path, err)
		}
		text := string(contents)
		declared := declarationsIn(text)

		for _, key := range keys {
			present := strings.Contains(text, key)
			if where.declaring {
				present = declared[key]
			}
			if !present {
				t.Errorf("%s does not DECLARE %s (a mention in a comment does not count).\n"+
					"A configuration variable lives in FOUR homes (apps/server/CLAUDE.md): .env.example, "+
					"infra/local/docker-compose.yml, .github/workflows/server.yml and README.md §Configuration. "+
					"A required one missing from compose or CI makes the container refuse to start, and compose "+
					"sits outside CI's path filters — so nothing else sees it before a human runs the L8 step.",
					name, key)
			}
		}
	}
}

// declarationsIn returns the keys a file declares: `KEY:` or `KEY=` on a line
// whose first non-space character is not `#`. Enough for a YAML mapping, a
// workflow's `-e KEY=value`, and a markdown table cell — and not enough for a
// commented-out line, which is the point.
func declarationsIn(text string) map[string]bool {
	declared := map[string]bool{}
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}
		for _, sep := range []string{":", "="} {
			for _, field := range strings.Fields(strings.ReplaceAll(trimmed, sep, sep+" ")) {
				if name, found := strings.CutSuffix(field, sep); found {
					declared[strings.Trim(name, "`|\"'")] = true
				}
			}
		}
	}
	return declared
}
