package survey

import (
	"context"
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
const uploadsDir = "uploads"

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
	return filepath.Join(s.WorkDir, RunProject(run.SurveyID, run.ID), uploadsDir)
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
		ScanPDF: filepath.ToSlash(filepath.Join(project, uploadsDir, batch)),
		Source:  filepath.ToSlash(runSource(surveyID, runID)),
		Ticked:  DefaultTicked,
		Unsure:  DefaultUnsure,
	})
	if err != nil {
		return AnalyzeResult{}, err
	}
	result := AnalyzeResult{}
	var recaptured []int
	if report.Batch != nil {
		if report.Batch.Captured == 0 {
			return AnalyzeResult{}, fmt.Errorf("%w: %s: %d unrecognised pages",
				ErrNothingCaptured, batch, report.Batch.Failed)
		}
		result.Captured, result.Failed = report.Batch.Captured, report.Batch.Failed
		recaptured = report.Batch.RecapturedCopies
	}
	printed, err := s.printedQuestions(ctx, run)
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

// printedQuestions are the bank's questions the run's snapshot holds.
func (s *Service) printedQuestions(ctx context.Context, run Run) ([]Question, error) {
	snapshot, err := s.Store.RunQuestions(ctx, run.ID)
	if err != nil {
		return nil, err
	}
	bank, err := s.Store.Questions(ctx, run.SurveyID)
	if err != nil {
		return nil, err
	}
	inRun := make(map[int64]bool, len(snapshot))
	for _, p := range snapshot {
		inRun[p.QuestionID] = true
	}
	var out []Question
	for _, q := range bank {
		if inRun[q.ID] {
			out = append(out, q)
		}
	}
	return out, nil
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

// CopyReading returns one copy of the run, or ErrCopyNotFound.
func (s *Service) CopyReading(ctx context.Context, runID int64, copyNumber int) (CopyView, error) {
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
