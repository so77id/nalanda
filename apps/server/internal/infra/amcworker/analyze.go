package amcworker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// Analyze runs POST /analyse against the worker. Serialised behind the same
// mutex as Generate: AMC's state is sqlite in the project directory and two
// runs against one project would race it, which is the whole reason this
// wrapper exists (ADR-0030 §The worker is threaded; AMC is not re-entrant).
//
// Analyse is minutes-class — a 40-copy batch is under a minute measured, but
// getimages + analyse + note + read_capture is orders of magnitude slower
// than a synchronous generate. The caller's context is what bounds the wait.
func (c *Client) Analyze(ctx context.Context, req controls.AnalyzeRequest) (controls.Report, error) {
	if req.Project == "" {
		return controls.Report{}, fmt.Errorf("%w: project path is required", controls.ErrAnalyzerRefused)
	}
	if req.ScanPDF == "" {
		return controls.Report{}, fmt.Errorf("%w: scan pdf path is required", controls.ErrAnalyzerRefused)
	}
	if req.Source == "" {
		return controls.Report{}, fmt.Errorf("%w: source path is required", controls.ErrAnalyzerRefused)
	}
	// Issue #197: the pair must respect the band rule before it crosses the
	// wire — the worker runs the same checks, and a refusal here is closer
	// to the caller that produced the bad pair.
	if !controls.ThresholdsValid(req.Ticked, req.Unsure) {
		return controls.Report{}, fmt.Errorf("%w: invalid thresholds (%v, %v)",
			controls.ErrAnalyzerRefused, req.Ticked, req.Unsure)
	}

	c.generateLock.Lock()
	defer c.generateLock.Unlock()

	body, err := json.Marshal(analyzeRequestBody{
		Project: req.Project,
		ScanPDF: req.ScanPDF,
		Source:  req.Source,
		Ticked:  req.Ticked,
		Unsure:  req.Unsure,
	})
	if err != nil {
		return controls.Report{}, fmt.Errorf("amcworker: encode analyse request: %w", err)
	}
	return c.postReport(ctx, "/analyse", body)
}

// Reanalyze runs POST /reanalyse against the worker. Same lock — the read
// re-opens AMC's sqlite files.
func (c *Client) Reanalyze(ctx context.Context, req controls.ReanalyzeRequest) (controls.Report, error) {
	if req.Project == "" {
		return controls.Report{}, fmt.Errorf("%w: project path is required", controls.ErrAnalyzerRefused)
	}
	if req.Ticked <= 0 || req.Ticked >= 1 {
		return controls.Report{}, fmt.Errorf("%w: ticked must be in (0,1), got %v", controls.ErrAnalyzerRefused, req.Ticked)
	}
	if req.Unsure < 0 || req.Unsure >= req.Ticked {
		return controls.Report{}, fmt.Errorf("%w: unsure must be in [0, ticked), got %v vs ticked %v", controls.ErrAnalyzerRefused, req.Unsure, req.Ticked)
	}

	c.generateLock.Lock()
	defer c.generateLock.Unlock()

	body, err := json.Marshal(reanalyzeRequestBody{
		Project: req.Project,
		Ticked:  req.Ticked,
		Unsure:  req.Unsure,
	})
	if err != nil {
		return controls.Report{}, fmt.Errorf("amcworker: encode reanalyse request: %w", err)
	}
	return c.postReport(ctx, "/reanalyse", body)
}

// postReport POSTs body to path and decodes the reading report. Shared by
// Analyze and Reanalyze because their success and failure envelopes are the
// same shape — only the request body differs.
func (c *Client) postReport(ctx context.Context, path string, body []byte) (controls.Report, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(body))
	if err != nil {
		return controls.Report{}, fmt.Errorf("amcworker: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return controls.Report{}, fmt.Errorf("amcworker: %w", err)
		}
		return controls.Report{}, fmt.Errorf("%w: %v", controls.ErrAnalyzerUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// A reading report is roomier than a generate response — 40 copies × 4
	// questions × doubtful entries plus metadata. 8 MiB is comfortably above
	// what a real batch produces and well below anything that would be a
	// runaway.
	const maxRead = 8 << 20
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxRead))
	if err != nil {
		return controls.Report{}, fmt.Errorf("%w: read response: %v", controls.ErrAnalyzerUnavailable, err)
	}

	if resp.StatusCode != http.StatusOK {
		// Issue #210: hand the caller a typed error carrying both fields
		// the worker reports. Callers that only branch keep using
		// errors.Is(err, ErrAnalyzerRefused) — the type unwraps to it;
		// callers that render the failure (handler flash, log) use
		// errors.As to reach Detail without re-parsing the message.
		var payload workerError
		if jerr := json.Unmarshal(respBody, &payload); jerr == nil && payload.Error != "" {
			return controls.Report{}, &controls.AnalyzerRefusedError{
				Message: fmt.Sprintf("worker answered %d: %s", resp.StatusCode, payload.Error),
				Detail:  payload.Detail,
			}
		}
		// The worker answered non-2xx with something that did not parse
		// as its error envelope — no fields to surface, so Detail stays
		// empty and Message carries the truncated body for the log.
		return controls.Report{}, &controls.AnalyzerRefusedError{
			Message: fmt.Sprintf("worker answered %d: %s", resp.StatusCode, truncateForLog(respBody)),
		}
	}

	var wire reportBody
	if err := json.Unmarshal(respBody, &wire); err != nil {
		return controls.Report{}, fmt.Errorf("%w: decode response: %v", controls.ErrAnalyzerRefused, err)
	}
	return wire.toDomain(), nil
}

// Assert the interface at compile time.
var _ controls.Analyzer = (*Client)(nil)

// --- wire shapes -------------------------------------------------------------

type analyzeRequestBody struct {
	Project string  `json:"project"`
	ScanPDF string  `json:"scan_pdf"`
	Source  string  `json:"source"`
	Ticked  float64 `json:"ticked"`
	Unsure  float64 `json:"unsure"`
}

type reanalyzeRequestBody struct {
	Project string  `json:"project"`
	Ticked  float64 `json:"ticked"`
	Unsure  float64 `json:"unsure"`
}

// reportBody mirrors read_capture.py's JSON shape.
type reportBody struct {
	Pages struct {
		Captured int `json:"captured"`
		Failed   int `json:"failed"`
	} `json:"pages"`
	Scoring struct {
		Seuil  float64 `json:"seuil"`
		Ticked float64 `json:"ticked"`
		Stale  bool    `json:"stale"`
	} `json:"scoring"`
	Copies      map[string]copyBody `json:"copies"`
	NeedsReview []string            `json:"needs_review"`
}

type copyBody struct {
	RUT               string       `json:"rut"`
	RUTStatus         string       `json:"rut_status"`
	Answers           []answerBody `json:"answers"`
	ExpectedQuestions int          `json:"expected_questions"`
	SeenQuestions     int          `json:"seen_questions"`
	MissingQuestions  []string     `json:"missing_questions"`
	Status            string       `json:"status"`
}

type answerBody struct {
	Question int            `json:"question"`
	Name     string         `json:"name"`
	Type     string         `json:"type"`
	Marked   []int          `json:"marked"`
	Doubtful []doubtfulBody `json:"doubtful"`
	Status   string         `json:"status"`
	Score    float64        `json:"score"`
	Max      float64        `json:"max"`
}

type doubtfulBody struct {
	Answer   int     `json:"answer"`
	Darkness float64 `json:"darkness"`
}

func (b reportBody) toDomain() controls.Report {
	out := controls.Report{
		Pages: controls.Pages{
			Captured: b.Pages.Captured,
			Failed:   b.Pages.Failed,
		},
		Scoring: controls.Scoring{
			Seuil:  b.Scoring.Seuil,
			Ticked: b.Scoring.Ticked,
			Stale:  b.Scoring.Stale,
		},
		Copies:      make(map[string]controls.ReportCopy, len(b.Copies)),
		NeedsReview: append([]string(nil), b.NeedsReview...),
	}
	for k, v := range b.Copies {
		out.Copies[k] = controls.ReportCopy{
			RUT:               v.RUT,
			RUTStatus:         controls.RUTStatus(v.RUTStatus),
			Answers:           toAnswers(v.Answers),
			ExpectedQuestions: v.ExpectedQuestions,
			SeenQuestions:     v.SeenQuestions,
			MissingQuestions:  append([]string(nil), v.MissingQuestions...),
			Status:            controls.CopyStatus(v.Status),
		}
	}
	return out
}

func toAnswers(in []answerBody) []controls.ReportAnswer {
	if len(in) == 0 {
		return nil
	}
	out := make([]controls.ReportAnswer, len(in))
	for i, a := range in {
		doubtful := make([]controls.Doubtful, len(a.Doubtful))
		for j, d := range a.Doubtful {
			doubtful[j] = controls.Doubtful{Answer: d.Answer, Darkness: d.Darkness}
		}
		out[i] = controls.ReportAnswer{
			Question: a.Question,
			Name:     a.Name,
			Type:     controls.QuestionType(a.Type),
			Marked:   append([]int(nil), a.Marked...),
			Doubtful: doubtful,
			Status:   controls.AnswerStatus(a.Status),
			Score:    a.Score,
			Max:      a.Max,
		}
	}
	return out
}
