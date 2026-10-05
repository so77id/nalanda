package survey

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey/tex"
)

// The run's two halves (issue #310), split the way the controls split
// PrepareControl from GenerateAssets (apps/server/CLAUDE.md, ADR-0050):
//
//   - CreateRun is SYNCHRONOUS and touches no worker: the row, its printed
//     snapshot and the sheet's source.tex on the shared volume.
//   - GenerateRunSheet is the ASYNC half the `survey_generate` job runs:
//     one /generate. A refusal there deletes nothing — the row and the
//     source stay, and the banner shows the failure (ADR-0050 §6).

// surveysDir is the subdirectory of the worker's /work volume every survey
// project lives under, beside the controls' `controls/`.
const surveysDir = "surveys"

// RunProject is a run's project directory relative to /work — the path the
// worker is handed and the server reads back under WorkDir.
func RunProject(surveyID, runID int64) string {
	return filepath.Join(surveysDir, strconv.FormatInt(surveyID, 10), "runs", strconv.FormatInt(runID, 10))
}

// runSource is the run's source.tex relative to /work.
func runSource(surveyID, runID int64) string {
	return filepath.Join(RunProject(surveyID, runID), "inputs", "source.tex")
}

// CreateRun creates a run of the survey and writes its sheet's source.
// The bank's current questions are what it prints, in PrintOrder.
func (s *Service) CreateRun(ctx context.Context, surveyID, createdBy int64, d RunDraft) (Run, error) {
	d, err := d.Normalize(true)
	if err != nil {
		return Run{}, err
	}
	one, err := s.Store.SurveyByID(ctx, surveyID)
	if err != nil {
		return Run{}, err
	}
	questions, err := s.Store.Questions(ctx, surveyID)
	if err != nil {
		return Run{}, err
	}
	if len(questions) == 0 {
		return Run{}, ErrEmptyBank
	}
	printed := PrintOrder(questions)

	run, err := s.Store.CreateRun(ctx, Run{
		SurveyID: surveyID, Name: d.Name, AppliedOn: d.AppliedOn, Copies: d.Copies,
		CreatedBy: createdBy, CreatedAt: s.Now(),
	}, printed)
	if err != nil {
		return Run{}, err
	}

	if err := s.writeSource(one, questions, printed, run); err != nil {
		// Nothing was printed and nothing can be: cancel the run so it does
		// not lock the bank for a sheet that never existed.
		if cerr := s.Store.CancelRun(ctx, surveyID, run.ID, s.Now()); cerr != nil {
			return Run{}, errors.Join(err, fmt.Errorf("cancelling the run after the source failed: %w", cerr))
		}
		return Run{}, err
	}
	return run, nil
}

func (s *Service) writeSource(one Survey, questions []Question, printed []RunQuestion, run Run) error {
	byID := make(map[int64]Question, len(questions))
	for _, q := range questions {
		byID[q.ID] = q
	}
	in := tex.Input{Title: one.Name, Description: one.Description, Copies: run.Copies}
	for _, p := range printed {
		q := byID[p.QuestionID]
		labels := make([]string, len(q.Alternatives))
		for i, a := range q.Alternatives {
			labels[i] = a.Label
		}
		in.Questions = append(in.Questions, tex.Question{
			Name:      tex.QuestionName(q.ID),
			Kind:      texKind(q.Kind),
			Statement: q.Statement,
			Section:   q.Section,
			Labels:    labels,
			Guide:     MarksGuide(q.MinMarks, q.MaxMarks),
		})
	}
	source, err := tex.Compile(in)
	if err != nil {
		return fmt.Errorf("survey: compiling run %d's sheet: %w", run.ID, err)
	}
	path := filepath.Join(s.WorkDir, runSource(run.SurveyID, run.ID))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("survey: preparing run %d's directory: %w", run.ID, err)
	}
	if err := os.WriteFile(path, []byte(source), 0o644); err != nil {
		return fmt.Errorf("survey: writing run %d's source: %w", run.ID, err)
	}
	return nil
}

func texKind(k QuestionKind) tex.Kind {
	switch k {
	case KindScale:
		return tex.Scale
	case KindMulti:
		return tex.Multi
	}
	return tex.Single
}

// GenerateRunSheet is the async half: one /generate for an open run whose
// source CreateRun wrote.
func (s *Service) GenerateRunSheet(ctx context.Context, surveyID, runID int64) error {
	run, err := s.Store.Run(ctx, surveyID, runID)
	if err != nil {
		return err
	}
	if run.State != RunOpen {
		return fmt.Errorf("survey: run %d is %s, not open", runID, run.State)
	}
	if _, err := s.Generator.GenerateSheet(ctx, GenerateRequest{
		Project: RunProject(surveyID, runID),
		Source:  runSource(surveyID, runID),
		Copies:  run.Copies,
	}); err != nil {
		return err
	}
	return nil
}

// SheetPath is where the server finds a run's printable PDF on the shared
// volume — the worker's `out/sujet.pdf` naming (ADR-0037).
func (s *Service) SheetPath(run Run) string {
	return filepath.Join(s.WorkDir, RunProject(run.SurveyID, run.ID), "out", "sujet.pdf")
}

// RunQuestions returns a run's snapshot in printed order.
func (s *Service) RunQuestions(ctx context.Context, runID int64) ([]RunQuestion, error) {
	return s.Store.RunQuestions(ctx, runID)
}

// Runs returns the survey's runs, most recent first.
func (s *Service) Runs(ctx context.Context, surveyID int64) ([]Run, error) {
	return s.Store.RunsForSurvey(ctx, surveyID)
}

// Run returns one run of the survey.
func (s *Service) Run(ctx context.Context, surveyID, runID int64) (Run, error) {
	return s.Store.Run(ctx, surveyID, runID)
}

// UpdateRun rewrites a run's name and date; the copies are printed and
// stay.
func (s *Service) UpdateRun(ctx context.Context, surveyID, runID int64, d RunDraft) error {
	d, err := d.Normalize(false)
	if err != nil {
		return err
	}
	return s.Store.UpdateRun(ctx, surveyID, runID, d, s.Now())
}

// CancelRun cancels an open run, releasing the bank if no other run holds
// it. The caller refuses first while a job about the run is in flight
// (the handler holds the jobs store); WP-3 adds "no scans".
func (s *Service) CancelRun(ctx context.Context, surveyID, runID int64) error {
	return s.Store.CancelRun(ctx, surveyID, runID, s.Now())
}

// RunSummaries is the list page's per-survey run count and latest date.
func (s *Service) RunSummaries(ctx context.Context, courseID int64) (map[int64]RunSummary, error) {
	return s.Store.RunSummaries(ctx, courseID)
}
