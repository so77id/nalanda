package survey

import (
	"context"
	"fmt"
	"path/filepath"
)

// A run's scans (issue #311), split the way the controls split them
// (apps/server/CLAUDE.md, ADR-0050): the upload writes the batch on the
// request goroutine (SaveUploadedBatch, S4), and the `survey_analyse` job
// reads it (AnalyzeBatch).

// uploadsDir is where a run's uploaded batches live inside its project,
// beside — never inside — AMC's own scans/.
const uploadsDir = "uploads"

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
