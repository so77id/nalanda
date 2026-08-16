package config_test

import (
	"os"
	"path/filepath"
	"testing"
)

// readExampleEnv returns the contents of apps/server/.env.example. The path is
// walked up from the test's working directory rather than hard-coded, so moving
// the package is a compile-time problem instead of a silent skip.
func readExampleEnv(t *testing.T) string {
	t.Helper()

	// internal/infra/config -> apps/server
	path := filepath.Join("..", "..", "..", ".env.example")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v — the example file is part of the contract, not optional", path, err)
	}
	return string(data)
}
