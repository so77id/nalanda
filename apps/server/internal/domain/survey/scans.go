package survey

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

// A run's scans (issue #311), split the way the controls split them
// (apps/server/CLAUDE.md, ADR-0050): the upload writes the batch on the
// request goroutine (SaveUploadedBatch, S4), and the `survey_analyse` job
// reads it (AnalyzeBatch).

// uploadsDir is where a run's uploaded batches live inside its project,
// beside — never inside — AMC's own scans/.
const uploadsDirName = "uploads"

// Batch files are batch-1.pdf, batch-2.pdf, … in upload order.
const (
	batchPrefix = "batch-"
	batchExt    = ".pdf"
)

// SaveUploadedBatch is the sync half of an upload: it writes the scanned
// PDF as the run's next batch-N.pdf ON THE REQUEST GOROUTINE, before the
// caller submits the survey_analyse job, and returns the batch's name.
// The file then survives every downstream failure (apps/server/CLAUDE.md,
// #210): it is what the professor cannot scan again. Only an open run
// takes scans (ErrRunNotOpen).
func (s *Service) SaveUploadedBatch(ctx context.Context, surveyID, runID int64, content io.ReadCloser) (string, error) {
	defer func() { _ = content.Close() }()
	run, err := s.Store.Run(ctx, surveyID, runID)
	if err != nil {
		return "", err
	}
	if run.State != RunOpen {
		return "", fmt.Errorf("survey: uploading to run %d: %w", runID, ErrRunNotOpen)
	}
	dir := s.uploadsDir(run)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("survey: preparing %s: %w", dir, err)
	}
	uploads, err := s.Uploads(run)
	if err != nil {
		return "", err
	}
	next := 1
	if len(uploads) > 0 {
		next = uploads[len(uploads)-1].Number + 1
	}
	name := batchPrefix + strconv.Itoa(next) + batchExt
	path := filepath.Join(dir, name)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", fmt.Errorf("survey: creating %s: %w", path, err)
	}
	if _, err := io.Copy(f, content); err != nil {
		_ = f.Close()
		_ = os.Remove(path) // a partial batch is not a batch
		return "", fmt.Errorf("survey: writing %s: %w", path, err)
	}
	if err := f.Close(); err != nil {
		return "", fmt.Errorf("survey: closing %s: %w", path, err)
	}
	return name, nil
}

// Upload is one batch on disk.
type Upload struct {
	Number int
	Name   string
	Bytes  int64
}

// Uploads lists the run's batches on disk, in upload order. None yet is
// an empty list, not an error.
func (s *Service) Uploads(run Run) ([]Upload, error) {
	entries, err := os.ReadDir(s.uploadsDir(run))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("survey: listing run %d's uploads: %w", run.ID, err)
	}
	var out []Upload
	for _, e := range entries {
		n, ok := batchNumber(e.Name())
		if !ok || e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			return nil, fmt.Errorf("survey: reading %s: %w", e.Name(), err)
		}
		out = append(out, Upload{Number: n, Name: e.Name(), Bytes: info.Size()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Number < out[j].Number })
	return out, nil
}

func (s *Service) uploadsDir(run Run) string {
	return filepath.Join(s.WorkDir, RunProject(run.SurveyID, run.ID), uploadsDirName)
}

func batchNumber(name string) (int, bool) {
	if !strings.HasPrefix(name, batchPrefix) || !strings.HasSuffix(name, batchExt) {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(name, batchPrefix), batchExt))
	return n, err == nil && n >= 1
}

// AnalyzeResult is what one batch read.
type AnalyzeResult struct {
	// Captured and Failed are this batch's pages placed and not placed.
	Captured int
	Failed   int
	// Counts is the whole run's reading after the batch.
	Counts ReadingCounts
}

// Notice is the done job's sentence for the professor.
func (r AnalyzeResult) Notice() string {
	msg := fmt.Sprintf("Se leyeron %d página(s) de este lote; la pasada tiene %d copia(s) leída(s)",
		r.Captured, r.Counts.Copies)
	if r.Counts.PendingCopies > 0 {
		msg += fmt.Sprintf(" y %d por revisar", r.Counts.PendingCopies)
	}
	msg += "."
	if r.Failed > 0 {
		msg += fmt.Sprintf(" %d página(s) no se reconocieron.", r.Failed)
	}
	return msg
}

// AnalyzeBatch is the async half: one /analyse of an uploaded batch, its
// report mapped onto what the run printed, stored in one transaction.
//
// Every failure leaves the batch on disk and the stored reading as the
// previous batch left it: the worker refusing, a batch with no page of
// this run (ErrNothingCaptured, before any write), a report naming what
// the run never printed (ErrReportMismatch, before any write).
func (s *Service) AnalyzeBatch(ctx context.Context, surveyID, runID int64, batch string) (AnalyzeResult, error) {
	run, err := s.Store.Run(ctx, surveyID, runID)
	if err != nil {
		return AnalyzeResult{}, err
	}
	if run.State != RunOpen {
		return AnalyzeResult{}, fmt.Errorf("survey: reading run %d: %w", runID, ErrRunNotOpen)
	}
	project := RunProject(surveyID, runID)
	report, err := s.Analyzer.AnalyzeSheets(ctx, AnalyzeRequest{
		Project: filepath.ToSlash(project),
		ScanPDF: filepath.ToSlash(filepath.Join(project, uploadsDirName, batch)),
		Source:  filepath.ToSlash(runSource(surveyID, runID)),
		Ticked:  DefaultTicked,
		Unsure:  DefaultUnsure,
	})
	if err != nil {
		return AnalyzeResult{}, err
	}
	if report.Batch.Captured == 0 {
		return AnalyzeResult{}, fmt.Errorf("%w: %s: %d unrecognised pages",
			ErrNothingCaptured, batch, report.Batch.Failed)
	}
	result := AnalyzeResult{Captured: report.Batch.Captured, Failed: report.Batch.Failed}
	recaptured := report.Batch.RecapturedCopies
	printed, _, err := s.printedQuestions(ctx, run)
	if err != nil {
		return AnalyzeResult{}, err
	}
	readings, err := ReadReport(report, printed)
	if err != nil {
		return AnalyzeResult{}, err
	}
	if err := s.Store.SaveReadings(ctx, runID, recaptured, readings); err != nil {
		return AnalyzeResult{}, fmt.Errorf("survey: storing run %d's reading: %w", runID, err)
	}
	if result.Counts, err = s.Store.ReadingCounts(ctx, runID); err != nil {
		return AnalyzeResult{}, err
	}
	return result, nil
}

// printedQuestions are the bank's questions the run's snapshot holds, and
// the number each was printed as — one read of the snapshot for both.
func (s *Service) printedQuestions(ctx context.Context, run Run) ([]Question, map[int64]int, error) {
	snapshot, err := s.Store.RunQuestions(ctx, run.ID)
	if err != nil {
		return nil, nil, err
	}
	bank, err := s.Store.Questions(ctx, run.SurveyID)
	if err != nil {
		return nil, nil, err
	}
	numbers := make(map[int64]int, len(snapshot))
	for _, p := range snapshot {
		numbers[p.QuestionID] = p.PrintedNumber
	}
	var out []Question
	for _, q := range bank {
		if _, ok := numbers[q.ID]; ok {
			out = append(out, q)
		}
	}
	return out, numbers, nil
}

// ReadingCounts is the run's reading at a glance.
func (s *Service) ReadingCounts(ctx context.Context, runID int64) (ReadingCounts, error) {
	return s.Store.ReadingCounts(ctx, runID)
}

// CopyView is one read copy with what it recorded and what waits.
type CopyView struct {
	Copy  Copy
	Marks []Mark
	Items []ReviewItem
}

// Copy returns one read copy of the run, or ErrCopyNotFound.
func (s *Service) Copy(ctx context.Context, runID int64, copyNumber int) (CopyView, error) {
	c, err := s.Store.CopyByNumber(ctx, runID, copyNumber)
	if err != nil {
		return CopyView{}, err
	}
	marks, err := s.Store.MarksForCopy(ctx, c.ID)
	if err != nil {
		return CopyView{}, err
	}
	items, err := s.Store.ItemsForCopy(ctx, c.ID)
	if err != nil {
		return CopyView{}, err
	}
	return CopyView{Copy: c, Marks: marks, Items: items}, nil
}

// ErrNoScans is a reset of a run with nothing to erase.
var ErrNoScans = errors.New("survey: the run has no scans")

// ErrResetHalfDone is a reset whose worker half succeeded — the files are
// gone — and whose database half failed: the copies are still there.
// Running the reset again finishes it (#311 review, COR-5).
var ErrResetHalfDone = errors.New("survey: the scans were erased but not the readings")

// ScanSummary is what "Borrar escaneos" puts in front of the professor
// before they confirm: what the reset destroys.
type ScanSummary struct {
	Uploads int
	Copies  int
	// Decided is how many review items the professor already resolved by
	// hand — work the reset throws away.
	Decided int
}

// HasScans reports whether a reset would destroy anything. A batch whose
// reading failed is an upload with no copy, and counts.
func (s ScanSummary) HasScans() bool { return s.Uploads > 0 || s.Copies > 0 }

// HasScans reports whether the run has scans — an uploaded batch or a
// read copy — the one rule behind cancelling and "Borrar escaneos".
func (s *Service) HasScans(ctx context.Context, run Run) (bool, error) {
	uploads, err := s.Uploads(run)
	if err != nil {
		return false, err
	}
	counts, err := s.Store.ReadingCounts(ctx, run.ID)
	if err != nil {
		return false, err
	}
	return ScanSummary{Uploads: len(uploads), Copies: counts.Copies}.HasScans(), nil
}

// ScanSummaryFor counts what a reset of the run would destroy.
func (s *Service) ScanSummaryFor(ctx context.Context, run Run) (ScanSummary, error) {
	uploads, err := s.Uploads(run)
	if err != nil {
		return ScanSummary{}, err
	}
	counts, err := s.Store.ReadingCounts(ctx, run.ID)
	if err != nil {
		return ScanSummary{}, err
	}
	decided, err := s.Store.DecidedItems(ctx, run.ID)
	if err != nil {
		return ScanSummary{}, err
	}
	return ScanSummary{Uploads: len(uploads), Copies: counts.Copies, Decided: decided}, nil
}

// ResetScans erases a run's scans and starts its reading over (issue #311,
// mirroring the controls' #298): the run stays open and printable, with no
// batch and no copy, and its next upload is batch-1.pdf.
//
// THE WORKER GOES FIRST: it owns the files on the shared volume, so it
// removes AMC's capture, the scan images and the uploaded batches. If it
// is busy, unreachable or refuses, nothing has been destroyed and the
// caller says so. Only then are the copies deleted (their marks and items
// cascade). The reverse order would leave AMC holding a capture the
// database forgot, and the next batch would bring it back.
func (s *Service) ResetScans(ctx context.Context, surveyID, runID int64) error {
	run, err := s.Store.Run(ctx, surveyID, runID)
	if err != nil {
		return err
	}
	if run.State != RunOpen {
		return fmt.Errorf("survey: resetting run %d: %w", runID, ErrRunNotOpen)
	}
	summary, err := s.ScanSummaryFor(ctx, run)
	if err != nil {
		return err
	}
	if !summary.HasScans() {
		return fmt.Errorf("survey: resetting run %d: %w", runID, ErrNoScans)
	}
	if err := s.Analyzer.ResetSurveyScans(ctx, filepath.ToSlash(RunProject(surveyID, runID))); err != nil {
		return err
	}
	if err := s.Store.DeleteReadings(ctx, runID); err != nil {
		return fmt.Errorf("survey: resetting run %d's readings: %w: %w", runID, ErrResetHalfDone, err)
	}
	return nil
}

// ScanImage finds one page image of a copy the run READ — the worker's
// `scans/copy-<n>-page-<p>` naming, PNG before JPG (the controls' rule: a
// raster scan comes out as JPG). ErrCopyNotFound for a copy the run has
// not read, or a page with no image.
func (s *Service) ScanImage(ctx context.Context, run Run, copyNumber, page int) (path, contentType string, err error) {
	if _, err := s.Store.CopyByNumber(ctx, run.ID, copyNumber); err != nil {
		return "", "", err
	}
	base := filepath.Join(s.WorkDir, RunProject(run.SurveyID, run.ID), "scans",
		"copy-"+strconv.Itoa(copyNumber)+"-page-"+strconv.Itoa(page))
	for _, ext := range []struct{ suffix, ctype string }{{".png", "image/png"}, {".jpg", "image/jpeg"}} {
		if _, err := os.Stat(base + ext.suffix); err == nil {
			return base + ext.suffix, ext.ctype, nil
		}
	}
	return "", "", fmt.Errorf("survey: copy %d page %d of run %d: %w", copyNumber, page, run.ID, ErrCopyNotFound)
}
