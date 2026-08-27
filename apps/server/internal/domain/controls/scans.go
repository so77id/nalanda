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
	// Ticked/Unsure (issue #197): the thresholds THIS batch is read and
	// scored at. Zero means "keep the control's stored pair" — the handler
	// resolves the form's optional fields against the control before
	// calling, so a concrete pair always arrives here.
	Ticked float64
	Unsure float64
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
//   - Copying the upload to disk failed → wraps the io error (the partial
//     file, if any, is removed inside writeUpload).
//   - /analyse refused or was unreachable → wraps ErrAnalyzer*. The
//     uploaded PDF SURVIVES on disk (issue #210): the batch is the
//     artefact an operator would inspect, and erasing it on refusal
//     forced a re-scan when the printed sheets — not the file — were
//     the problem (2026-08-19 incident). The DB is not touched on this
//     branch — Analyzer.Analyze runs before any store write.
//
// DB-atomicity is scoped: the reading report itself is transactional
// because UpsertReadingsFromReport opens a single tx around every insert
// it does. The three post-analyse writes as a sequence are NOT — they go
// through two different stores (Store.SetControlThresholds first, then
// two ReadingStore calls) and there is no outer transaction wrapping
// them. A failure in MarkMissingAsNotPresent (last step) leaves the
// updated thresholds and the persisted report committed; a failure in
// UpsertReadingsFromReport leaves the updated thresholds committed. In
// operation this class of failure is a store outage and the professor
// retries — a widened transactional shape (single-tx PersistReport) is
// a follow-up, same as the SaveOverrides note below.
func (s *Service) UploadScan(ctx context.Context, req UploadRequest) (UploadResult, error) {
	save, err := s.SaveUploadedBatch(ctx, req)
	if err != nil {
		return UploadResult{}, err
	}
	report, err := s.AnalyzeBatch(ctx, req.ControlID, save.BatchName, save.Ticked, save.Unsure)
	if err != nil {
		return UploadResult{}, err
	}
	return UploadResult{
		BatchNumber: save.BatchNumber,
		ScanPath:    filepath.Join(projectPrefix, req.ControlID, uploadsDir, save.BatchName),
		Report:      report,
	}, nil
}

// SaveUploadedBatch is the sync half of the upload flow (issue #249):
// validate the control, resolve thresholds, mkdir uploads/, pick the
// next batch number and stream the PDF onto disk. Runs on the HTTP
// handler's goroutine because the professor is uploading bytes — no
// runner in the middle. Returns the batch name + resolved thresholds
// the async AnalyzeBatch runs against.
func (s *Service) SaveUploadedBatch(ctx context.Context, req UploadRequest) (SaveUploadedBatchResult, error) {
	control, err := s.Store.ControlByID(ctx, req.ControlID)
	if err != nil {
		return SaveUploadedBatchResult{}, err
	}
	ticked, unsure := req.Ticked, req.Unsure
	if ticked == 0 {
		ticked, unsure = control.Ticked, control.Unsure
	}
	if !ThresholdsValid(ticked, unsure) {
		return SaveUploadedBatchResult{}, fmt.Errorf("%w: invalid thresholds (%v, %v)",
			ErrAnalyzerRefused, ticked, unsure)
	}

	projectDir := s.ProjectDir(control.ID)
	uploads := filepath.Join(projectDir, uploadsDir)
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		return SaveUploadedBatchResult{}, fmt.Errorf("controls.SaveUploadedBatch: prepare %s: %w", uploads, err)
	}
	batch, err := nextBatchNumber(uploads)
	if err != nil {
		return SaveUploadedBatchResult{}, fmt.Errorf("controls.SaveUploadedBatch: %w", err)
	}
	batchName := fmt.Sprintf("%s%d%s", scanFilePrefix, batch, scanFileExt)
	batchHostPath := filepath.Join(uploads, batchName)

	if err := writeUpload(batchHostPath, req.Content); err != nil {
		return SaveUploadedBatchResult{}, fmt.Errorf("controls.SaveUploadedBatch: %w", err)
	}
	return SaveUploadedBatchResult{
		BatchNumber: batch,
		BatchName:   batchName,
		Ticked:      ticked,
		Unsure:      unsure,
	}, nil
}

// SaveUploadedBatchResult is what SaveUploadedBatch returns to the HTTP
// handler so it can then Submit an analyse job.
type SaveUploadedBatchResult struct {
	BatchNumber int
	BatchName   string
	Ticked      float64
	Unsure      float64
}

// AnalyzeBatch is the async half of the upload flow (issue #249): from
// Analyzer.Analyze onward. Called by the analyse job handler in the
// runner goroutine; the batch file must already exist on disk.
//
// Failure modes match the pre-#249 UploadScan (same wrapped errors,
// same batch-survives-failure contract). The three post-analyse writes
// have the same non-atomic sequencing note: a mid-loop store outage
// leaves the earlier writes committed — a follow-up widens the tx.
func (s *Service) AnalyzeBatch(ctx context.Context, controlID, batchName string, ticked, unsure float64) (Report, error) {
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return Report{}, err
	}
	project := filepath.Join(projectPrefix, control.ID)
	report, err := s.Analyzer.Analyze(ctx, AnalyzeRequest{
		Project: project,
		ScanPDF: filepath.ToSlash(filepath.Join(project, uploadsDir, batchName)),
		Source:  filepath.ToSlash(filepath.Join(project, "inputs", "source.tex")),
		Ticked:  ticked,
		Unsure:  unsure,
	})
	if err != nil {
		return Report{}, err
	}
	if err := s.Store.SetControlThresholds(ctx, control.ID, ticked, unsure); err != nil {
		return Report{}, fmt.Errorf("controls.AnalyzeBatch: persist thresholds: %w", err)
	}
	now := s.Now()
	if err := s.Readings.UpsertReadingsFromReport(ctx, control.ID, report, now); err != nil {
		return Report{}, fmt.Errorf("controls.AnalyzeBatch: persist: %w", err)
	}
	if err := s.Readings.MarkMissingAsNotPresent(ctx, control.ID, now); err != nil {
		return Report{}, fmt.Errorf("controls.AnalyzeBatch: mark missing: %w", err)
	}
	s.annotateCleanCopies(ctx, control, report)
	if control.State == Generated {
		if err := s.Readings.SetControlState(ctx, control.ID, InReview); err != nil {
			s.Log.Warn("controls.AnalyzeBatch: state transition failed", "control", control.ID, "error", err)
		}
	}
	return report, nil
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
	// Issue #197: the pair this re-read used becomes the control's — the
	// next annotate (and the next reanalyse's defaults) agree with it.
	if err := s.Store.SetControlThresholds(ctx, control.ID, ticked, unsure); err != nil {
		return Report{}, fmt.Errorf("controls.Reanalyze: persist thresholds: %w", err)
	}
	// The stored annotated PDFs were drawn at the PREVIOUS thresholds, so
	// they no longer agree with the report just persisted — same class as
	// the report-vs-grade disagreement ADR-0031 exists to forbid. Drop the
	// rows and re-annotate the copies the new reading accepts as clean
	// (issue #197: ruta A over the new report), so the professor does not
	// have to save copy by copy to see corrected PDFs again.
	if err := s.Store.ClearAnnotated(ctx, control.ID); err != nil {
		return Report{}, fmt.Errorf("controls.Reanalyze: clear annotated: %w", err)
	}
	s.annotateCleanCopies(ctx, control, report)
	return report, nil
}

// AnnotateAllCleanCopies is the close-time defensive re-annotate
// (issue #249, S6): walk the persisted readings and call
// Service.Annotate for every copy in status ok. Per-copy failures are
// logged and swallowed — same "annotate is best-effort" policy as
// annotateCleanCopies below. Returns an error only when the whole
// flow cannot start (control missing, readings unreadable).
func (s *Service) AnnotateAllCleanCopies(ctx context.Context, controlID string) error {
	if _, err := s.Store.ControlByID(ctx, controlID); err != nil {
		return err
	}
	readings, err := s.Readings.ReadingsByControl(ctx, controlID)
	if err != nil {
		return err
	}
	for _, r := range readings {
		if r.CopyStatus != CopyStatusOK {
			continue
		}
		if _, err := s.Annotate(ctx, controlID, r.CopyNumber); err != nil {
			s.Log.Warn("controls: annotate on close failed",
				"control", controlID, "copy", r.CopyNumber, "error", err)
		}
	}
	return nil
}

// annotateCleanCopies runs ruta A over a report: one Service.Annotate per
// status:ok copy. One /annotate/copy call per copy is seconds-class, and
// the flows that call this were minutes-class anyway. A failure must not
// fail the caller's operation: the reading is already persisted and the
// professor can retry the same copy from the review page (ruta B) — or
// switch the whole loop off by config.
func (s *Service) annotateCleanCopies(ctx context.Context, control Control, report Report) {
	for key, copy := range report.Copies {
		if copy.Status != CopyStatusOK {
			continue
		}
		copyNumber, err := strconv.Atoi(key)
		if err != nil {
			// The worker keys copies by decimal string; a key that does not
			// parse is a worker-side contract break, not something a retry
			// would fix.
			s.Log.Warn("controls: unparseable copy key", "control", control.ID, "key", key)
			continue
		}
		if _, err := s.Annotate(ctx, control.ID, copyNumber); err != nil {
			s.Log.Warn("controls: annotate failed",
				"control", control.ID, "copy", copyNumber, "error", err)
		}
	}
}

// ThresholdsValid reports whether a ticked/unsure pair respects the band
// rule the reader's contract depends on: ticked inside (0,1) and unsure
// strictly below it. Shared by the Service (defense in depth) and the
// handlers (form validation) — the worker runs the same rule.
func ThresholdsValid(ticked, unsure float64) bool {
	return ticked > 0 && ticked < 1 && unsure >= 0 && unsure < ticked
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
//
// The flag gates the READ too, not only the write: rows produced while
// the flow was on are hidden when the operator flips it off, because the
// escape hatch exists precisely for the scenario where the surviving
// rows are the stale or broken ones.
func (s *Service) AnnotatedFor(ctx context.Context, controlID string, copyNumber int) (AnnotatedCopy, bool, error) {
	if !s.AnnotateEnabled {
		return AnnotatedCopy{}, false, nil
	}
	return s.Store.AnnotatedByCopy(ctx, controlID, copyNumber)
}

// RUTAction reports what happened to the RUT during SaveOverrides — the
// distinction that lets the surface build a professor-facing flash without
// re-deriving state (issue #228 S3). Empty submissions are refused by the
// handler, so the empty case is not represented here.
type RUTAction string

const (
	// RUTActionUpdated: an override was written and the effective RUT
	// changed (either it is a new override, or the override's value
	// differs from what was there before).
	RUTActionUpdated RUTAction = "updated"
	// RUTActionMatchedRead: the submission equalled what AMC originally
	// read, so any prior override was cleared. This is the branch that
	// looked like "nothing persisted" to Miguel in the 2026-08-26 report
	// (issue #228 S2 diagnosis H1) — the flash now names it explicitly.
	RUTActionMatchedRead RUTAction = "matched_read"
	// RUTActionUnchanged: the submitted value matched what was already
	// effective (either an override matching itself, or a bare AMC read
	// with no override — the ClearRUTOverride call was a no-op).
	RUTActionUnchanged RUTAction = "unchanged"
)

// SaveOverridesResult reports what SaveOverrides did, so the surface can
// build a flash that names the actual outcome. See RUTAction for the RUT
// half; AnswersChanged counts answers whose Override state moved (either a
// clear that removed a prior override, or an upsert that stored a value
// different from what was already stored).
type SaveOverridesResult struct {
	RUTAction      RUTAction
	RUTFrom        string // effective RUT the reading had before the save.
	RUTTo          string // effective RUT the reading has after the save.
	AnswersChanged int
}

// SaveOverrides applies a professor's edits to a single reading. The
// request carries the RUT and one entry per question in the reading's
// pool with the new marked set. A submitted set that MATCHES what AMC
// read for that question clears any prior override; anything else
// upserts one. The RUT logic is symmetric.
//
// Empty RUT is a no-op on the RUT half (RUTAction stays Unchanged): the
// main Guardar submission is refused by the handler before calling here,
// but the "Marcar en blanco" question button IS allowed through with an
// empty RUT — the copy may not have had a RUT read yet, and the button's
// purpose is to blank a single answer, not to force a RUT edit
// (issue #228 S3 review COR-3).
//
// Returns a SaveOverridesResult that names the actual outcome (was the
// RUT set anew, cleared to AMC's read, or unchanged; how many answers
// moved), so the surface can render a flash the professor can trust.
func (s *Service) SaveOverrides(ctx context.Context, req SaveOverridesRequest) (SaveOverridesResult, error) {
	reading, err := s.Readings.ReadingByCopy(ctx, req.ControlID, req.CopyNumber)
	if err != nil {
		return SaveOverridesResult{}, err
	}
	now := s.Now()

	result := SaveOverridesResult{
		RUTAction: RUTActionUnchanged,
		RUTFrom:   effectiveRUT(reading),
		RUTTo:     effectiveRUT(reading),
	}

	// RUT — the override is what shows up beside the AMC read on the
	// review page; setting it back to what AMC read clears the override.
	rutMatchesRead := reading.RUTRead != nil && *reading.RUTRead == req.RUT
	switch {
	case req.RUT == "":
		// No RUT half to apply; see the docstring for when this branch
		// is reachable.
	case rutMatchesRead && reading.RUTStatus == RUTStatusOK:
		if err := s.Readings.ClearRUTOverride(ctx, reading.ID); err != nil {
			return result, err
		}
		if reading.RUTOverride != nil {
			result.RUTAction = RUTActionMatchedRead
			result.RUTTo = *reading.RUTRead
		}
	default:
		if err := s.Readings.SetRUTOverride(ctx, reading.ID, req.RUT, now); err != nil {
			return result, err
		}
		if reading.RUTOverride == nil || reading.RUTOverride.RUT != req.RUT {
			result.RUTAction = RUTActionUpdated
			result.RUTTo = req.RUT
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
				return result, err
			}
			if ans.Override != nil {
				result.AnswersChanged++
			}
			continue
		}
		override := AnswerOverride{
			Marked:   edit.Marked,
			Status:   edit.Status,
			EditedAt: now,
		}
		if err := s.Readings.SetAnswerOverride(ctx, reading.ID, edit.QuestionRef, override); err != nil {
			return result, err
		}
		if ans.Override == nil || !sameOverride(*ans.Override, override) {
			result.AnswersChanged++
		}
	}
	return result, nil
}

// effectiveRUT is what the review page would display for the reading:
// the override if any, else what AMC read, else empty.
func effectiveRUT(r Reading) string {
	if r.RUTOverride != nil {
		return r.RUTOverride.RUT
	}
	if r.RUTRead != nil {
		return *r.RUTRead
	}
	return ""
}

// sameOverride reports whether two answer overrides carry the same
// professor-visible state. EditedAt is ignored — the timestamp is
// bookkeeping, not something the professor edited.
func sameOverride(a, b AnswerOverride) bool {
	return sameMarksAndStatus(a.Status, a.Marked, b.Status, b.Marked)
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
	return sameMarksAndStatus(a.Status, a.Marked, edit.Status, edit.Marked)
}

// sameMarksAndStatus reports whether two (status, marks) pairs represent
// the same professor-visible answer. Marks are compared as multisets
// (order-independent, duplicates counted). Extracted from `sameOverride`
// and `matchesRead`, which were near-identical (S3 review ARQ-2).
func sameMarksAndStatus(s1 AnswerStatus, m1 []int, s2 AnswerStatus, m2 []int) bool {
	if s1 != s2 || len(m1) != len(m2) {
		return false
	}
	seen := make(map[int]int, len(m1))
	for _, m := range m1 {
		seen[m]++
	}
	for _, m := range m2 {
		if seen[m] == 0 {
			return false
		}
		seen[m]--
	}
	return true
}

// IsBatchName reports whether a name matches the on-disk batch contract
// batch-<positive int>.pdf (batchNumber). Exported because the upload
// handler validates its URL segment against the SAME rule (issue #204
// review) — the contract has one home, and every reader of the naming
// goes through it.
func IsBatchName(name string) bool {
	_, ok := batchNumber(name)
	return ok
}

// batchNumber parses a filename into its batch number when it matches the
// on-disk contract batch-<positive int>.pdf, ok=false otherwise. One home
// for the contract, shared by nextBatchNumber (naming the next batch),
// UploadList (listing the existing ones, issue #204) and the handler's
// URL validation (IsBatchName) — readers of the same naming must not
// drift.
func batchNumber(name string) (int, bool) {
	if !strings.HasPrefix(name, scanFilePrefix) || !strings.HasSuffix(name, scanFileExt) {
		return 0, false
	}
	trimmed := strings.TrimSuffix(strings.TrimPrefix(name, scanFilePrefix), scanFileExt)
	n, err := strconv.Atoi(trimmed)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
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
		if n, ok := batchNumber(e.Name()); ok {
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

// UploadList returns the names of the scan batches already on disk for a
// control, ordered by batch number. Only files matching the on-disk
// contract count (batch-N.pdf, batchNumber); the handler renders one
// download link per entry (issue #204). Empty when nothing was uploaded
// yet or the directory does not exist — the page then shows nothing.
func (s *Service) UploadList(controlID string) ([]string, error) {
	dir := filepath.Join(s.ProjectDir(controlID), uploadsDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("controls.UploadList: read %s: %w", dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if _, ok := batchNumber(e.Name()); ok {
			names = append(names, e.Name())
		}
	}
	sort.Slice(names, func(i, j int) bool {
		a, _ := batchNumber(names[i])
		b, _ := batchNumber(names[j])
		return a < b
	})
	return names, nil
}

// UploadPath composes the host-side path of one uploaded batch. The name
// must already match the batch contract — the handler validates at the URL
// boundary (issue #204); this is a path join, not a validation.
func (s *Service) UploadPath(controlID, name string) string {
	return filepath.Join(s.ProjectDir(controlID), uploadsDir, name)
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
