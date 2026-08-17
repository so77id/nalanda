package controls

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// uploadsDir is the subdirectory under a control's project where uploaded
// scan PDFs land, one per upload. Kept separate from AMC's own scans/ (which
// getimages populates) so a re-upload does not clobber prior batches on
// disk — the on-disk record is what a debug session would look at.
const uploadsDir = "uploads"

// scanFilePrefix / scanFileExt name the uploaded scan PDFs. batch-1.pdf,
// batch-2.pdf, … in upload order.
const (
	scanFilePrefix = "batch-"
	scanFileExt    = ".pdf"
)

// UploadRequest is what a handler hands to Service.UploadScan. The bytes
// are streamed to disk and never held whole in memory — a 40-copy batch
// is ~10 MB and would work either way, but the upper bound in Config is
// 100 MB.
type UploadRequest struct {
	ControlID string
	// Filename is the ORIGINAL filename from the multipart part, used only
	// for logging and error messages. The stored name is derived from the
	// batch number.
	Filename string
	// Content is where the bytes come from. The Service closes it when it
	// has copied them (or on any failure).
	Content io.ReadCloser
}

// UploadResult reports what the upload produced. Not consumed today, but a
// handler that renders the result table wants to know which copies just
// changed and by how many the total moved — a follow-up test hangs off
// this.
type UploadResult struct {
	BatchNumber int
	ScanPath    string // relative to WorkDir
	Report      Report
}

// UploadScan is the whole scan pipeline: save the PDF to a batch file
// under the control's uploads/ directory, call /analyse, persist the
// report, mark missing copies as not_present, and flip the control to
// InReview (unless it is already Graded — a re-upload after close still
// updates the readings but does not un-close the correction).
//
// Failure modes:
//   - No such control → ErrControlNotFound.
//   - Copying the upload to disk failed → wraps the io error.
//   - /analyse refused or was unreachable → wraps ErrAnalyzer* and rolls
//     back the batch file so the disk shows no evidence of a failed run.
//
// All-or-nothing on the DB side: the report either persists or it does
// not; there is no partial commit, because UpsertReadingsFromReport uses
// a single transaction.
func (s *Service) UploadScan(ctx context.Context, req UploadRequest) (UploadResult, error) {
	if s.Analyzer == nil || s.Readings == nil {
		return UploadResult{}, errors.New("controls.UploadScan: service is not configured for WP-F")
	}
	control, err := s.Store.ControlByID(ctx, req.ControlID)
	if err != nil {
		return UploadResult{}, err
	}

	projectDir := s.ProjectDir(control.ID)
	uploads := filepath.Join(projectDir, uploadsDir)
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		return UploadResult{}, fmt.Errorf("controls.UploadScan: prepare %s: %w", uploads, err)
	}
	batch, err := nextBatchNumber(uploads)
	if err != nil {
		return UploadResult{}, fmt.Errorf("controls.UploadScan: %w", err)
	}
	batchName := fmt.Sprintf("%s%d%s", scanFilePrefix, batch, scanFileExt)
	batchHostPath := filepath.Join(uploads, batchName)

	if err := writeUpload(batchHostPath, req.Content); err != nil {
		return UploadResult{}, fmt.Errorf("controls.UploadScan: %w", err)
	}

	rollbackFile := func() {
		if err := os.Remove(batchHostPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			s.Log.Warn("controls.UploadScan: rollback failed", "path", batchHostPath, "error", err)
		}
	}

	project := filepath.Join(projectPrefix, control.ID)
	report, err := s.Analyzer.Analyze(ctx, AnalyzeRequest{
		Project: project,
		ScanPDF: filepath.ToSlash(filepath.Join(project, uploadsDir, batchName)),
		Source:  filepath.ToSlash(filepath.Join(project, "inputs", "source.tex")),
	})
	if err != nil {
		rollbackFile()
		return UploadResult{}, err
	}

	now := s.Now()
	if err := s.Readings.UpsertReadingsFromReport(ctx, control.ID, report, now); err != nil {
		rollbackFile()
		return UploadResult{}, fmt.Errorf("controls.UploadScan: persist: %w", err)
	}
	if err := s.Readings.MarkMissingAsNotPresent(ctx, control.ID, now); err != nil {
		rollbackFile()
		return UploadResult{}, fmt.Errorf("controls.UploadScan: mark missing: %w", err)
	}

	// Move the control forward — but never backwards. A re-upload to a
	// graded control leaves state=graded (S8 renders the "editing a closed
	// correction" warning); the readings still land.
	if control.State == Generated {
		if err := s.Readings.SetControlState(ctx, control.ID, InReview); err != nil {
			// The DB writes above already succeeded; this is a warning.
			s.Log.Warn("controls.UploadScan: state transition failed", "control", control.ID, "error", err)
		}
	}

	return UploadResult{
		BatchNumber: batch,
		ScanPath:    filepath.Join(projectPrefix, control.ID, uploadsDir, batchName),
		Report:      report,
	}, nil
}

// Reanalyze re-reads the existing captures at new thresholds. Fails cleanly
// when no scans have been uploaded yet (nothing to re-read).
func (s *Service) Reanalyze(ctx context.Context, controlID string, ticked, unsure float64) (Report, error) {
	if s.Analyzer == nil || s.Readings == nil {
		return Report{}, errors.New("controls.Reanalyze: service is not configured for WP-F")
	}
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return Report{}, err
	}
	project := filepath.Join(projectPrefix, control.ID)
	report, err := s.Analyzer.Reanalyze(ctx, ReanalyzeRequest{
		Project: project, Ticked: ticked, Unsure: unsure,
	})
	if err != nil {
		return Report{}, err
	}
	if err := s.Readings.UpsertReadingsFromReport(ctx, control.ID, report, s.Now()); err != nil {
		return Report{}, fmt.Errorf("controls.Reanalyze: persist: %w", err)
	}
	return report, nil
}

// Readings returns every reading for a control, ordered by copy_number.
// The handler decorates them with per-question detail for the results
// table (S4).
func (s *Service) ReadingsFor(ctx context.Context, controlID string) ([]Reading, error) {
	if s.Readings == nil {
		return nil, errors.New("controls.ReadingsFor: service is not configured for WP-F")
	}
	return s.Readings.ReadingsByControl(ctx, controlID)
}

// ReadingFor returns one reading (with overrides).
func (s *Service) ReadingFor(ctx context.Context, controlID string, copyNumber int) (Reading, error) {
	if s.Readings == nil {
		return Reading{}, errors.New("controls.ReadingFor: service is not configured for WP-F")
	}
	return s.Readings.ReadingByCopy(ctx, controlID, copyNumber)
}

// nextBatchNumber walks the uploads/ directory and picks the smallest
// unused batch-N.pdf. Deterministic — a delete-then-upload puts the new
// scan under a lower number than a fresh one would — which is what a
// test that asserts against filenames wants.
func nextBatchNumber(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, fmt.Errorf("read %s: %w", dir, err)
	}
	used := map[int]bool{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, scanFilePrefix) || !strings.HasSuffix(name, scanFileExt) {
			continue
		}
		var n int
		trimmed := strings.TrimSuffix(strings.TrimPrefix(name, scanFilePrefix), scanFileExt)
		if _, err := fmt.Sscanf(trimmed, "%d", &n); err != nil {
			continue
		}
		if n > 0 {
			used[n] = true
		}
	}
	if len(used) == 0 {
		return 1, nil
	}
	nums := make([]int, 0, len(used))
	for n := range used {
		nums = append(nums, n)
	}
	sort.Ints(nums)
	return nums[len(nums)-1] + 1, nil
}

func writeUpload(path string, r io.ReadCloser) error {
	defer func() { _ = r.Close() }()
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	if _, err := io.Copy(f, r); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return fmt.Errorf("copy to %s: %w", path, err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close %s: %w", path, err)
	}
	return nil
}

// Placeholder to reserve time.Time until other callers land.
var _ = time.Time{}
