package amcworker

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// AnalyzeSheets is Analyze for a survey run's batch (issue #311): the same
// /analyse, the same lock, answered in the survey domain's types and
// sentinels — survey never sees a controls type (ADR-0078). Only the
// per-answer part of the report crosses: a survey sheet has no ID grid, so
// the copy's status, RUT and score mean nothing (ADR-0080 §8).
func (c *Client) AnalyzeSheets(ctx context.Context, req survey.AnalyzeRequest) (survey.Report, error) {
	switch {
	case req.Project == "":
		return survey.Report{}, fmt.Errorf("%w: project path is required", survey.ErrAnalyzerRefused)
	case req.ScanPDF == "":
		return survey.Report{}, fmt.Errorf("%w: scan pdf path is required", survey.ErrAnalyzerRefused)
	case req.Source == "":
		return survey.Report{}, fmt.Errorf("%w: source path is required", survey.ErrAnalyzerRefused)
	}

	c.generateLock.Lock()
	defer c.generateLock.Unlock()

	body, err := json.Marshal(analyzeRequestBody{
		Project: req.Project, ScanPDF: req.ScanPDF, Source: req.Source,
		Ticked: req.Ticked, Unsure: req.Unsure,
	})
	if err != nil {
		return survey.Report{}, fmt.Errorf("amcworker: encode analyse request: %w", err)
	}
	wire, err := c.postWire(ctx, "/analyse", body, surveyWorkerErrors)
	if err != nil {
		return survey.Report{}, err
	}
	return wire.toSurvey(), nil
}

var surveyWorkerErrors = workerErrors{
	refused:     survey.ErrAnalyzerRefused,
	unavailable: survey.ErrAnalyzerUnavailable,
	refusal: func(status int, message, detail string) error {
		if detail != "" {
			return fmt.Errorf("%w: worker answered %d: %s (%s)", survey.ErrAnalyzerRefused, status, message, detail)
		}
		return fmt.Errorf("%w: worker answered %d: %s", survey.ErrAnalyzerRefused, status, message)
	},
}

// toSurvey keeps the per-answer part of the report, copies in number order.
// A worker that predates `batch` gets the legacy default Analyze applies
// (#298): the project total stands in for this run.
func (b reportBody) toSurvey() survey.Report {
	out := survey.Report{Batch: survey.Batch{Captured: b.Pages.Captured}}
	if b.Batch != nil {
		out.Batch = survey.Batch{
			Captured: b.Batch.Captured, Failed: b.Batch.Failed,
			RecapturedCopies: append([]int(nil), b.Batch.RecapturedCopies...),
		}
	}
	for key, c := range b.Copies {
		number, err := strconv.Atoi(key)
		if err != nil {
			// The worker keys copies by their decimal number; anything else
			// is not a copy this server could address.
			continue
		}
		pages := append([]int(nil), b.PagesPerCopy[key]...)
		if len(pages) == 0 {
			pages = []int{1}
		}
		copyReport := survey.ReportCopy{CopyNumber: number, Pages: pages}
		for _, a := range c.Answers {
			answer := survey.ReportAnswer{
				Name: a.Name, Status: survey.AnswerStatus(a.Status),
				Marked: append([]int(nil), a.Marked...),
			}
			for _, d := range a.Doubtful {
				answer.Doubtful = append(answer.Doubtful, d.Answer)
			}
			copyReport.Answers = append(copyReport.Answers, answer)
		}
		out.Copies = append(out.Copies, copyReport)
	}
	sort.Slice(out.Copies, func(i, j int) bool { return out.Copies[i].CopyNumber < out.Copies[j].CopyNumber })
	return out
}

// Assert the interface at compile time.
var _ survey.Analyzer = (*Client)(nil)
