// Package internal_test holds this app's architecture tests (L4 in
// docs/standards/testing-strategy.md): invariants agreed in standards and ADRs,
// enforced rather than described.
//
// It lives at internal/ rather than next to one layer because the invariant is
// about the relationship BETWEEN the layers.
//
// It parses the source tree with go/parser instead of shelling out to
// `go list`, and that is not a style preference — it is what makes the guard
// run at all. A test package that imports nothing from the module is considered
// unchanged by the build cache whatever happens to the code, and a subprocess is
// invisible to it: with `go list` here, adding a forbidden import and running
// `go test ./...` replayed a cached PASS. Reading the files makes them inputs
// the cache tracks. Found by mutation, #149 S5.
package internal_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
)

const modulePath = "github.com/so77id/nalanda/apps/server"

// The layers of ADR-0033 §C11, innermost first.
const (
	domainPrefix = modulePath + "/internal/domain"
	appPrefix    = modulePath + "/internal/app"
	infraPrefix  = modulePath + "/internal/infra"
)

// moduleRoot is where the walk starts: apps/server, one level up from this
// package, so cmd/ and migrations/ are covered too.
const moduleRoot = ".."

// readPackages returns every package in the module, mapped to the import paths
// it depends on TRANSITIVELY.
//
// Only non-test files are parsed. A test may reach for whatever it needs to set
// a case up; the rule is about what the shipped code depends on.
func readPackages(t *testing.T) map[string][]string {
	t.Helper()

	direct := map[string][]string{}
	fset := token.NewFileSet()

	err := filepath.WalkDir(moduleRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			// The root is exempt from the hidden-directory rule below: its own
			// name is "..", which starts with a dot, so skipping it aborts the
			// entire walk and every guard in this file then passes vacuously.
			// That is not hypothetical — it is what this code did first, and
			// only TestTheWalkSeesTheWholeModule caught it (#149 S5).
			if path == moduleRoot {
				return nil
			}
			// Nothing under a hidden directory is a Go package, and testdata is
			// excluded from builds by the toolchain itself.
			if name := entry.Name(); name == "testdata" || strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}

		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		file, err := parser.ParseFile(fset, path, source, parser.ImportsOnly)
		if err != nil {
			return err
		}

		pkgPath := importPathOf(t, path)
		// Register the package even when it imports nothing, so the
		// non-vacuity guards below count it.
		if _, seen := direct[pkgPath]; !seen {
			direct[pkgPath] = nil
		}
		for _, spec := range file.Imports {
			imported, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				t.Fatalf("%s: unquoting import %s: %v", path, spec.Path.Value, err)
			}
			if !slices.Contains(direct[pkgPath], imported) {
				direct[pkgPath] = append(direct[pkgPath], imported)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", moduleRoot, err)
	}

	return transitiveClosure(direct)
}

// importPathOf turns a file path under apps/server into the import path of the
// package that contains it.
func importPathOf(t *testing.T, path string) string {
	t.Helper()

	rel, err := filepath.Rel(moduleRoot, filepath.Dir(path))
	if err != nil {
		t.Fatalf("relative path of %s: %v", path, err)
	}
	if rel == "." {
		return modulePath
	}
	return modulePath + "/" + filepath.ToSlash(rel)
}

// transitiveClosure expands each package's direct imports through the other
// packages of this module. A domain package that reaches a driver through
// another domain package is just as broken as one that imports it outright, and
// only the closure can see that.
func transitiveClosure(direct map[string][]string) map[string][]string {
	closure := map[string][]string{}

	for pkg := range direct {
		seen := map[string]bool{}
		var visit func(string)
		visit = func(current string) {
			for _, dep := range direct[current] {
				if seen[dep] {
					continue
				}
				seen[dep] = true
				// Only intra-module packages have a body to walk into; a
				// third-party path is a leaf here, which is all these tests
				// need to know about it.
				if strings.HasPrefix(dep, modulePath) {
					visit(dep)
				}
			}
		}
		visit(pkg)

		deps := make([]string, 0, len(seen))
		for dep := range seen {
			deps = append(deps, dep)
		}
		sort.Strings(deps)
		closure[pkg] = deps
	}
	return closure
}

// inLayer reports whether pkg IS the layer rooted at prefix, or lives below it.
func inLayer(pkg, prefix string) bool {
	return pkg == prefix || strings.HasPrefix(pkg, prefix+"/")
}

// packageDirs lists the import path of every directory under the module root
// holding at least one non-test .go file, found by walking directories rather
// than by parsing them.
//
// It exists to be a SECOND, independent opinion about what the module contains:
// readPackages parses files, this counts directories, and the walk guard below
// asserts the two agree. A single mechanism cannot notice that it stopped
// seeing something.
func packageDirs(t *testing.T) []string {
	t.Helper()

	dirs := map[string]bool{}
	err := filepath.WalkDir(moduleRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if path == moduleRoot {
				return nil
			}
			if name := entry.Name(); name == "testdata" || strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, "_test.go") {
			dirs[importPathOf(t, path)] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s for package directories: %v", moduleRoot, err)
	}

	paths := make([]string, 0, len(dirs))
	for dir := range dirs {
		paths = append(paths, dir)
	}
	sort.Strings(paths)

	if len(paths) == 0 {
		t.Fatalf("no package directories found under %s", moduleRoot)
	}
	return paths
}

// surfaceDirs lists the delivery surfaces: the immediate subdirectories of
// internal/app. Derived rather than listed, so a third surface is guarded the
// day it is created — WP-C3 grows this tree.
func surfaceDirs(t *testing.T) []string {
	t.Helper()

	entries, err := os.ReadDir(filepath.Join(moduleRoot, "internal", "app"))
	if err != nil {
		t.Fatalf("reading internal/app: %v", err)
	}

	var surfaces []string
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			surfaces = append(surfaces, appPrefix+"/"+entry.Name())
		}
	}
	if len(surfaces) < 2 {
		t.Fatalf("found %d delivery surfaces under internal/app, want at least the two of ADR-0033 — "+
			"with fewer, the sibling-import guard verifies nothing", len(surfaces))
	}
	return surfaces
}

// TestTheDomainDependsOnNothingAboveIt is the rule DocumentBuddy's own ADR-005
// records as violated in 13 files, and the reason issue #149 chose to correct on
// entry rather than port the debt. A domain that imports its delivery surface or
// its driver cannot be tested without them, and cannot be reused by the second
// surface — which is the entire premise of one binary with two.
func TestTheDomainDependsOnNothingAboveIt(t *testing.T) {
	packages := readPackages(t)

	var checked int
	for pkg, deps := range packages {
		if !inLayer(pkg, domainPrefix) {
			continue
		}
		checked++

		for _, dep := range deps {
			switch {
			case inLayer(dep, appPrefix):
				t.Errorf(
					"%s depends on %s.\nThe domain may not reach its delivery surfaces. "+
						"Move the type into internal/domain, or invert the call with an "+
						"interface declared in the domain (see health.Prober).",
					pkg, dep,
				)
			case inLayer(dep, infraPrefix):
				t.Errorf(
					"%s depends on %s.\nThe domain may not reach its adapters. "+
						"Declare the interface it needs IN the domain and implement it in "+
						"internal/infra (see health.Prober, implemented by storage.Prober).",
					pkg, dep,
				)
			}
		}
	}

	// Non-vacuity. A walk that found no domain packages passes every assertion
	// above while checking nothing — which is how this file would go green
	// through a rename of the very tree it is meant to be guarding.
	if checked == 0 {
		t.Fatalf(
			"no packages found under %s, so this test verified nothing. "+
				"If the layer moved, repoint domainPrefix.", domainPrefix,
		)
	}
}

// The domain must not depend on a third-party library either: an interface
// declared in terms of someone else's struct is the same coupling wearing a
// different hat, and it is how a driver ends up dictating a business type. The
// standard library is fine — context and time are not a dependency in the sense
// that matters here.
func TestTheDomainDependsOnNoThirdPartyLibrary(t *testing.T) {
	packages := readPackages(t)

	var checked int
	for pkg, deps := range packages {
		if !inLayer(pkg, domainPrefix) {
			continue
		}
		checked++

		for _, dep := range deps {
			if strings.HasPrefix(dep, modulePath) {
				continue // intra-module, judged by the test above
			}
			// A standard-library import path has no dot in its first segment.
			if first, _, _ := strings.Cut(dep, "/"); !strings.Contains(first, ".") {
				continue
			}
			t.Errorf(
				"%s depends on the third-party package %s.\nThe domain is expressed in "+
					"this project's own types and the standard library; an adapter for it "+
					"belongs in internal/infra.",
				pkg, dep,
			)
		}
	}
	if checked == 0 {
		t.Fatalf("no packages found under %s, so this test verified nothing", domainPrefix)
	}
}

// Infra is beneath the surfaces, not beside them: it holds adapters, and an
// adapter that reaches up into a delivery surface has inverted the layering
// ADR-0033 draws. This edge went unguarded in the first version of this file —
// the domain edge and the sibling edge were covered and this one was not, so
// `internal/infra/storage` could import `internal/app/web` in full green
// (#149 review, F1). WP-C2 puts OIDC and session storage in infra, which is
// exactly where the pull towards the backoffice starts.
func TestInfraDependsOnNothingAboveIt(t *testing.T) {
	packages := readPackages(t)

	var checked int
	for pkg, deps := range packages {
		if !inLayer(pkg, infraPrefix) {
			continue
		}
		checked++

		for _, dep := range deps {
			if inLayer(dep, appPrefix) {
				t.Errorf(
					"%s depends on %s.\nInfra is beneath the surfaces, not beside them. "+
						"A handler's needs belong to the surface; if the adapter genuinely "+
						"needs a value the surface owns, pass it in from cmd/server.",
					pkg, dep,
				)
			}
		}
	}
	if checked == 0 {
		t.Fatalf("no packages found under %s, so this test verified nothing", infraPrefix)
	}
}

// The two delivery surfaces are siblings, not a stack. One that imports the
// other stops being separately deployable and, more immediately, makes the
// backoffice's authentication decisions reachable from the anonymous API — the
// exact seam WP-C2 will be defending.
func TestNeitherSurfaceImportsTheOther(t *testing.T) {
	packages := readPackages(t)
	// Derived from the tree, not listed. A literal pair stopped being the whole
	// truth the moment internal/app grew a third directory, and WP-C3 grows it
	// (#149 review, COR-6).
	surfaces := surfaceDirs(t)

	var checked int
	for pkg, deps := range packages {
		owner := ""
		for _, surface := range surfaces {
			if inLayer(pkg, surface) {
				owner = surface
			}
		}
		if owner == "" {
			continue
		}
		checked++

		for _, other := range surfaces {
			if other == owner {
				continue
			}
			if slices.ContainsFunc(deps, func(dep string) bool { return inLayer(dep, other) }) {
				t.Errorf(
					"%s depends on %s.\nThe two surfaces share the domain, never each other. "+
						"Move what they have in common into internal/domain, or into "+
						"internal/infra when it is transport machinery (see httpjson).",
					pkg, other,
				)
			}
		}
	}
	if checked == 0 {
		t.Fatalf("neither %s found, so this test verified nothing", strings.Join(surfaces, " nor "))
	}
}

// A guard that reads the tree is only as good as its reading. If the walk finds
// nothing, or misses a package that certainly exists, every assertion above
// passes vacuously — so the walk itself is asserted.
//
// The expected set is DERIVED, not listed. It was a hand-written list of nine
// import paths for exactly one slice, and it had already drifted by the time it
// was reviewed: internal/infra/selfcheck was added in S6 and never reached the
// list, so the walk could have stopped seeing that package in silence (#149
// review, A4/COR-5). A list that must be edited when a package is added is a
// list that will drift again.
func TestTheWalkSeesTheWholeModule(t *testing.T) {
	packages := readPackages(t)

	for _, expected := range packageDirs(t) {
		if _, found := packages[expected]; !found {
			t.Errorf("the walk did not find %s — the layer guards above cannot see it either", expected)
		}
	}

	// A directory walk and a parse walk can only disagree by one being wrong.
	if len(packages) != len(packageDirs(t)) {
		t.Errorf("the parse found %d packages and the directory walk found %d — they must agree",
			len(packages), len(packageDirs(t)))
	}

	// And the closure has to be transitive, not merely direct: cmd/server
	// imports storage, which imports the SQLite driver, so the driver must
	// appear among the command's dependencies even though it is nowhere in its
	// own import block.
	const driver = "modernc.org/sqlite"
	if !slices.Contains(packages[modulePath+"/cmd/server"], driver) {
		t.Errorf("cmd/server's dependencies do not include %s, so the closure is not "+
			"transitive and a violation reached through an intermediate package would go unseen", driver)
	}
}
