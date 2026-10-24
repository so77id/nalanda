package uploads

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sort"
	"strings"
	"time"
)

// The bounds on what the partials may cost (decision 3, Miguel, 2026-10-24),
// as constants rather than configuration: no new variable (#339 Goal 6).
const (
	// MaxOpenPerProfessor is how many uploads one professor may have open.
	// Creating one more removes their least-recently-grown partial instead
	// of refusing: a refusal would block a professor for up to IdleAfter
	// behind partials they can neither see nor cancel.
	MaxOpenPerProfessor = 4
	// IdleAfter is how long a partial may go without growing before the
	// sweep removes it. The server cannot tell a closed tab from a link that
	// is down — both are "no chunk arrived" — so the window is long enough
	// for a dropped connection to come back and resume. With the cap above
	// it bounds the disk at MaxOpenPerProfessor × MaxBytes per professor.
	IdleAfter = 24 * time.Hour
	// SweepEvery is how often a running server sweeps; it also sweeps at boot.
	SweepEvery = time.Hour
)

// Sweep removes every upload that has not grown for longer than idle, and
// answers how many it removed. It reads only names that are an upload's own
// (`<uid>.part`, `.json`, `.tmp` directly under Root); anything else on the
// shared volume is logged and left where it is.
func (s *Service) Sweep(now time.Time, idle time.Duration) (int, error) {
	ids, err := s.onDisk()
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, id := range ids {
		if s.sweepOne(id, now, idle) {
			removed++
		}
	}
	return removed, nil
}

func (s *Service) sweepOne(id string, now time.Time, idle time.Duration) bool {
	unlock := s.locks.lock(id)
	defer unlock()
	last, ok := s.lastGrown(id)
	if !ok || now.Sub(last) <= idle {
		return false
	}
	s.removeFiles(id)
	s.Log.Info("uploads: swept an idle partial", "upload", id, "last_grown", last)
	return true
}

// Watch sweeps every interval until ctx ends. The boot sweep is the caller's,
// so that its failure is reported in the boot sequence.
func (s *Service) Watch(ctx context.Context, every time.Duration, now func() time.Time) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := s.Sweep(now(), IdleAfter); err != nil {
				s.Log.Warn("uploads: sweeping idle partials", "error", err)
			}
		}
	}
}

// evictBeyondCap makes room for one more of this professor's uploads by
// removing their least-recently-grown partials past MaxOpenPerProfessor − 1.
// Only uploads whose sidecar names this professor count: one that does not
// validate belongs to nobody and is the sweep's.
func (s *Service) evictBeyondCap(professor int64) error {
	ids, err := s.onDisk()
	if err != nil {
		return err
	}
	type open struct {
		id   string
		last time.Time
	}
	var mine []open
	for _, id := range ids {
		sc, err := s.readSidecar(id)
		if err != nil || sc.Professor != professor {
			continue
		}
		if last, ok := s.lastGrown(id); ok {
			mine = append(mine, open{id, last})
		}
	}
	sort.Slice(mine, func(i, j int) bool {
		if !mine[i].last.Equal(mine[j].last) {
			return mine[i].last.Before(mine[j].last)
		}
		return mine[i].id < mine[j].id
	})
	for len(mine) >= MaxOpenPerProfessor {
		s.evict(professor, mine[0].id)
		mine = mine[1:]
	}
	return nil
}

func (s *Service) evict(professor int64, id string) {
	unlock := s.locks.lock(id)
	defer unlock()
	// Re-read under the lock: a complete or a cancel may have got there first.
	if _, err := s.load(professor, id); err != nil {
		return
	}
	s.removeFiles(id)
	s.Log.Info("uploads: evicted a professor's least-recently-grown partial",
		"upload", id, "professor", professor, "cap", MaxOpenPerProfessor)
}

// onDisk lists the uploads that have at least one file under Root. A name that
// is not one of an upload's three is reported and skipped — never touched.
func (s *Service) onDisk() ([]string, error) {
	list, err := os.ReadDir(s.Root)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("uploads: list %s: %w", s.Root, err)
	}
	seen := map[string]bool{}
	var ids []string
	for _, entry := range list {
		id, ok := uploadOf(entry.Name())
		if !ok {
			s.Log.Warn("uploads: leaving alone a file that is no upload's", "dir", s.Root, "file", entry.Name())
			continue
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// uploadOf answers whose file a name is, if it is an upload's at all.
func uploadOf(name string) (string, bool) {
	for _, ext := range []string{extPart, extSidecar, extTemp} {
		if id, ok := strings.CutSuffix(name, ext); ok && isID(id) {
			return id, true
		}
	}
	return "", false
}

// lastGrown is when any of an upload's files last changed — in practice the
// partial's last chunk. ok is false when none of them exists any more.
func (s *Service) lastGrown(id string) (time.Time, bool) {
	var last time.Time
	found := false
	for _, ext := range []string{extPart, extSidecar, extTemp} {
		info, err := os.Lstat(s.path(id, ext))
		if err != nil {
			continue
		}
		found = true
		if info.ModTime().After(last) {
			last = info.ModTime()
		}
	}
	return last, found
}
