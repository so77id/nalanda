package controls

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
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

	// Issue #190, ruta A: every copy the reader accepted as clean gets its
	// annotated PDF right away, before any human touches the queue. One
	// /annotate/copy call per copy is seconds-class, and the batch as a
	// whole was minutes-class anyway.
	//
	// A failure here must not fail the upload: the reading is already
	// persisted and the professor can retry the same copy from the review
	// page (ruta B) — or switch the whole loop off by config.
	for key, copy := range report.Copies {
		if copy.Status != CopyStatusOK {
			continue
		}
		copyNumber, err := strconv.Atoi(key)
		if err != nil {
			// The worker keys copies by decimal string; a key that does not
			// parse is a worker-side contract break, not something a retry
			// would fix.
			s.Log.Warn("controls.UploadScan: unparseable copy key", "control", control.ID, "key", key)
			continue
		}
		if _, err := s.Annotate(ctx, control.ID, copyNumber); err != nil {
			s.Log.Warn("controls.UploadScan: annotate failed",
				"control", control.ID, "copy", copyNumber, "error", err)
		}
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
	return s.Readings.ReadingsByControl(ctx, controlID)
}

// ReadingFor returns one reading (with overrides).
func (s *Service) ReadingFor(ctx context.Context, controlID string, copyNumber int) (Reading, error) {
	return s.Readings.ReadingByCopy(ctx, controlID, copyNumber)
}

// AnnotatedFor returns the anotado PDF record for one copia, or
// exists=false when the copia has not been annotated yet — the review
// page's cue to fall back to the raw scan (issue #190).
func (s *Service) AnnotatedFor(ctx context.Context, controlID string, copyNumber int) (AnnotatedCopy, bool, error) {
	return s.Store.AnnotatedByCopy(ctx, controlID, copyNumber)
}

// SaveOverrides applies a professor's edits to a single reading. The
// request carries the RUT (empty means "no change" — the review handler
// enforces its own precondition) and one entry per question in the
// reading's pool with the new marked set. A submitted set that MATCHES
// what AMC read for that question clears any prior override; anything
// else upserts one. The RUT logic is symmetric.
func (s *Service) SaveOverrides(ctx context.Context, req SaveOverridesRequest) error {
	reading, err := s.Readings.ReadingByCopy(ctx, req.ControlID, req.CopyNumber)
	if err != nil {
		return err
	}
	now := s.Now()

	// RUT — the override is what shows up beside the AMC read on the
	// review page; setting it back to what AMC read clears the override.
	rutMatchesRead := reading.RUTRead != nil && *reading.RUTRead == req.RUT
	switch {
	case req.RUT == "":
		// Empty submission is ignored — the review form always sends the
		// current visible RUT (either the read value or the override).
	case rutMatchesRead && reading.RUTStatus == RUTStatusOK:
		if err := s.Readings.ClearRUTOverride(ctx, reading.ID); err != nil {
			return err
		}
	default:
		if err := s.Readings.SetRUTOverride(ctx, reading.ID, req.RUT, now); err != nil {
			return err
		}
	}

	// Per question — clear when the submission matches what AMC read,
	// upsert otherwise.
	for _, edit := range req.Answers {
		ans, ok := findAnswer(reading, edit.QuestionRef)
		if !ok {
			// Silently drop questions the reading does not know — the
			// form was generated for a stale reading; the professor's
			// next attempt will re-read the correct set.
			continue
		}
		if matchesRead(ans, edit) {
			if err := s.Readings.ClearAnswerOverride(ctx, reading.ID, edit.QuestionRef); err != nil {
				return err
			}
			continue
		}
		override := AnswerOverride{
			Marked:   edit.Marked,
			Status:   edit.Status,
			EditedAt: now,
		}
		if err := s.Readings.SetAnswerOverride(ctx, reading.ID, edit.QuestionRef, override); err != nil {
			return err
		}
	}
	return nil
}

// CloseCorrection moves a control to Graded, refusing when the gate is
// not satisfied. The rules mirror closeGate in the handler; enforcing
// them here means a request that skipped the disabled-button UI still
// hits the same guard.
func (s *Service) CloseCorrection(ctx context.Context, controlID string) error {
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return err
	}
	if control.State == Graded {
		return nil // already closed — idempotent
	}
	readings, err := s.Readings.ReadingsByControl(ctx, controlID)
	if err != nil {
		return err
	}
	for _, r := range readings {
		if r.CopyStatus == CopyStatusNotPresent {
			continue
		}
		if r.CopyStatus == CopyStatusIncomplete {
			return ErrCloseBlocked
		}
		if r.RUTStatus == RUTStatusUnreadable && r.RUTOverride == nil {
			return ErrCloseBlocked
		}
		for _, a := range r.Answers {
			effective := a.Status
			if a.Override != nil {
				effective = a.Override.Status
			}
			// Blocks on the EFFECTIVE status — an override that itself lands
			// doubtful/ambiguous is not resolution. Reachable today because
			// statusFor() can produce Ambiguous for a simple question with
			// two marks.
			if effective == AnswerStatusDoubtful || effective == AnswerStatusAmbiguous {
				return ErrCloseBlocked
			}
		}
	}
	return s.Readings.SetControlState(ctx, controlID, Graded)
}

// ErrCloseBlocked is returned when CloseCorrection refuses because a
// failure kind is still unresolved.
var ErrCloseBlocked = errors.New("controls: the correction cannot close while a failure kind is unresolved")

// SaveOverridesRequest carries the whole edit the professor's form
// produced. NOT atomic across per-question override upserts: each
// Set/Clear is its own transaction (readings.SetAnswerOverride uses
// BeginTx), so a mid-loop store failure leaves the earlier edits and
// the RUT edit persisted. A follow-up WP that wants strict atomicity
// would widen ReadingStore with a single-tx SaveOverrides.
type SaveOverridesRequest struct {
	ControlID  string
	CopyNumber int
	RUT        string
	Answers    []AnswerEdit
}

// AnswerEdit is one question's new state.
type AnswerEdit struct {
	QuestionRef string
	Marked      []int
	Status      AnswerStatus
}

func findAnswer(r Reading, ref string) (Answer, bool) {
	for _, a := range r.Answers {
		if a.QuestionRef == ref {
			return a, true
		}
	}
	return Answer{}, false
}

// matchesRead reports whether an edit brings the answer back to what AMC
// originally read (same marks in any order, same status).
func matchesRead(a Answer, edit AnswerEdit) bool {
	if a.Status != edit.Status {
		return false
	}
	if len(a.Marked) != len(edit.Marked) {
		return false
	}
	seen := make(map[int]int, len(a.Marked))
	for _, m := range a.Marked {
		seen[m]++
	}
	for _, m := range edit.Marked {
		if seen[m] == 0 {
			return false
		}
		seen[m]--
	}
	return true
}

// nextBatchNumber walks the uploads/ directory and returns one past the
// highest existing batch-N.pdf (max+1). Empty dir → 1. If the highest
// batch is deleted the next number goes back to fill the gap — the
// uploads dir is the persisted state and no counter lives outside it.
// Names that do not match batch-<positive int>.pdf are ignored.
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
		trimmed := strings.TrimSuffix(strings.TrimPrefix(name, scanFilePrefix), scanFileExt)
		n, err := strconv.Atoi(trimmed)
		if err != nil {
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
