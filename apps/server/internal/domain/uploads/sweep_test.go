package uploads_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/uploads"
)

// grownAt sets when an upload last grew: the time its files were last
// written, which is what the eviction and the sweep read.
func grownAt(t *testing.T, root, id string, at time.Time) {
	t.Helper()
	for _, ext := range []string{".part", ".json"} {
		if err := os.Chtimes(filepath.Join(root, id+ext), at, at); err != nil {
			t.Fatalf("Chtimes: %v", err)
		}
	}
}

func openOne(t *testing.T, s *uploads.Service, prof int64) string {
	t.Helper()
	up, err := s.Create(prof, aControl, "scan.pdf", 100, nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	return up.ID
}

// Decision 3 (Miguel, 2026-10-24): four open uploads per professor, and a
// fifth REMOVES the least-recently-grown rather than refusing — a refusal
// would block a professor for up to a day behind partials they can neither
// see nor cancel (four closed tabs on a bad-network day).
func TestAFifthUploadEvictsTheProfessorsLeastRecentlyGrown(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	base := time.Now().Add(-time.Hour)

	var mine []string
	for range uploads.MaxOpenPerProfessor {
		mine = append(mine, openOne(t, s, professor))
	}
	// Created first, but it grew last: growth, not age, decides.
	grownAt(t, root, mine[0], base.Add(40*time.Minute))
	grownAt(t, root, mine[1], base.Add(10*time.Minute)) // the least recently grown
	grownAt(t, root, mine[2], base.Add(20*time.Minute))
	grownAt(t, root, mine[3], base.Add(30*time.Minute))
	// Another professor's partials are older still, and none of this
	// professor's business.
	var theirs []string
	for range uploads.MaxOpenPerProfessor {
		id := openOne(t, s, professor+1)
		grownAt(t, root, id, base)
		theirs = append(theirs, id)
	}

	fifth := openOne(t, s, professor)

	if _, err := s.Status(professor, mine[1]); !errors.Is(err, uploads.ErrNotFound) {
		t.Errorf("the least recently grown upload survived the fifth: %v", err)
	}
	for _, id := range []string{mine[0], mine[2], mine[3], fifth} {
		if _, err := s.Status(professor, id); err != nil {
			t.Errorf("upload %s was evicted, want only the least recently grown: %v", id, err)
		}
	}
	for _, id := range theirs {
		if _, err := s.Status(professor+1, id); err != nil {
			t.Errorf("another professor's upload %s went with it: %v", id, err)
		}
	}
}

// AC-9. A partial that has not grown for a day is removed; one that grew
// within the day stays, since the server cannot tell a closed tab from a link
// that is still down.
func TestTheSweepRemovesOnlyPartialsIdlePastTheWindow(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	now := time.Now()
	stale := openOne(t, s, professor)
	fresh := openOne(t, s, professor)
	grownAt(t, root, stale, now.Add(-uploads.IdleAfter-time.Minute))
	grownAt(t, root, fresh, now.Add(-uploads.IdleAfter+time.Minute))

	removed, err := s.Sweep(now)
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	if removed != 1 {
		t.Errorf("Sweep removed %d, want 1", removed)
	}
	if _, err := s.Status(professor, stale); !errors.Is(err, uploads.ErrNotFound) {
		t.Errorf("the idle partial survived the sweep: %v", err)
	}
	if _, err := s.Status(professor, fresh); err != nil {
		t.Errorf("a partial still within the window was swept: %v", err)
	}
	if left := entries(t, root); slices.ContainsFunc(left, func(n string) bool { return strings.HasPrefix(n, stale) }) {
		t.Errorf("the swept upload left files behind: %v", left)
	}
}

// What a crash between the writes of a create leaves — a sidecar with no
// partial, or the sidecar's temp file — is an upload's too, and goes with it.
func TestTheSweepRemovesWhatACrashedCreateLeft(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	now := time.Now()
	old := now.Add(-2 * uploads.IdleAfter)
	for _, name := range []string{
		"AAAAAAAAAAAAAAAAAAAAAAAAAA.json",
		"BBBBBBBBBBBBBBBBBBBBBBBBBB.tmp",
	} {
		path := filepath.Join(root, name)
		if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, old, old); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := s.Sweep(now); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if left := entries(t, root); len(left) != 0 {
		t.Errorf("the sweep left %v", left)
	}
}

// Security point 1. The directory is on the volume the AMC worker mounts as
// root, so the sweep deletes only names that are an upload's own — anything
// else, however old, is reported and left alone.
func TestTheSweepNeverDeletesANameOutsideThePattern(t *testing.T) {
	root := t.TempDir()
	var logs bytes.Buffer
	s := uploads.NewService(uploads.Service{
		Root: root, MaxBytes: 64 << 10,
		Log: slog.New(slog.NewTextHandler(&logs, nil)),
	})
	old := time.Now().Add(-30 * 24 * time.Hour)
	foreign := []string{
		"notes.txt",
		"SHORT.part",                       // not a uid
		"MOZMMCHZLSQ3NEKN2P7CO5APNM.partx", // a uid, not one of the three names
		"mozmmchzlsq3nekn2p7co5apnm.part",  // the wrong alphabet
		"MOZMMCHZLSQ3NEKN2P7CO5APNM",       // no extension at all
	}
	for _, name := range foreign {
		path := filepath.Join(root, name)
		if err := os.WriteFile(path, []byte("keep"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, old, old); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "subdir"), 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := s.Sweep(time.Now()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	// And the eviction walks the same directory.
	for range uploads.MaxOpenPerProfessor + 1 {
		openOne(t, s, professor)
	}

	left := entries(t, root)
	for _, name := range append(foreign, "subdir") {
		if !slices.Contains(left, name) {
			t.Errorf("%s was deleted, want it left alone", name)
		}
	}
	if !strings.Contains(logs.String(), "notes.txt") || !strings.Contains(logs.String(), "level=WARN") {
		t.Errorf("a foreign name was not reported:\n%s", logs.String())
	}
}

// Watch sweeps on its own tick, and returns when the server stops.
func TestWatchSweepsOnEveryTickAndStopsWithTheContext(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	stale := openOne(t, s, professor)
	grownAt(t, root, stale, time.Now().Add(-2*uploads.IdleAfter))

	ticks := make(chan struct{}, 1)
	now := func() time.Time {
		select {
		case ticks <- struct{}{}:
		default:
		}
		return time.Now()
	}
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		s.Watch(ctx, 5*time.Millisecond, now)
		close(stopped)
	}()
	// Two ticks: the second only starts once the first sweep has finished.
	for i := range 2 {
		select {
		case <-ticks:
		case <-time.After(2 * time.Second):
			t.Fatalf("no tick after 2s (saw %d)", i)
		}
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("Watch did not return once the context ended")
	}
	if _, err := s.Status(professor, stale); !errors.Is(err, uploads.ErrNotFound) {
		t.Errorf("the ticking sweep left the idle partial: %v", err)
	}
}

// #339 review, COR-1: the sweep takes the upload's lock, so a partial that
// looked idle a moment ago but is growing right now is not deleted under the
// append that is growing it.
func TestTheSweepWaitsForAnAppendInFlight(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	source := aPDF(200)
	up, err := s.Create(professor, aControl, "scan.pdf", int64(len(source)), nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	grownAt(t, root, up.ID, time.Now().Add(-2*uploads.IdleAfter))
	growing := newGatedReader(source[:100])
	appended := make(chan error, 1)
	go func() {
		_, err := s.Append(professor, up.ID, 0, growing)
		appended <- err
	}()
	<-growing.started

	swept := make(chan int, 1)
	go func() {
		n, _ := s.Sweep(time.Now())
		swept <- n
	}()
	removed, finished := 0, false
	select {
	case removed = <-swept:
		finished = true
	case <-time.After(200 * time.Millisecond):
	}
	close(growing.gate)
	if err := <-appended; err != nil {
		t.Fatalf("the append: %v", err)
	}
	if !finished {
		removed = <-swept
	}

	if removed != 0 {
		t.Errorf("the sweep removed %d uploads, want 0 — it deleted a partial mid-append", removed)
	}
	if status, err := s.Status(professor, up.ID); err != nil || status.Received != 100 {
		t.Errorf("after the sweep: %+v, %v; want the upload with 100 bytes", status, err)
	}
}
