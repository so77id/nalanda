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
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// ResetScans runs POST /scans/reset against the worker (issue #298): it
// removes the project's capture, scan images, page lists and uploaded
// PDFs, and keeps its layout and inputs. Same lock as every other call —
// it deletes the sqlite file an analyse would be writing.
//
// A worker that predates the route answers 404 through its dispatcher,
// before any handler runs, and that arrives here as ErrAnalyzerRefused:
// the caller destroys nothing on its side either.
//
// TryLock, not Lock: the lock is one mutex for EVERY project and does not
// watch ctx, and the caller is a request goroutine the professor is
// waiting on. Behind another control's minutes-long analyse, Lock would
// hold the request far past its deadline and the server's write timeout
// (measured in the #298 review, COR-1). A busy worker refuses at once.
func (c *Client) ResetScans(ctx context.Context, project string) error {
	return c.resetScans(ctx, project, resetErrors{
		workerErrors: controlsWorkerErrors,
		busy:         controls.ErrAnalyzerBusy,
	})
}

// ResetSurveyScans is ResetScans for a survey run's project (issue #311):
// the same route, the same TryLock, the survey's sentinels — so the survey
// never names a controls error (ADR-0078). The SECOND synchronous worker
// call; it qualifies on the same two properties as the first (it only
// removes files, it never waits on the lock) — ADR-0081.
func (c *Client) ResetSurveyScans(ctx context.Context, project string) error {
	return c.resetScans(ctx, project, resetErrors{
		workerErrors: surveyWorkerErrors,
		busy:         survey.ErrAnalyzerBusy,
	})
}

// resetErrors are a reset's sentinels: the reading ones, plus busy.
type resetErrors struct {
	workerErrors
	busy error
}

// resetScans is POST /scans/reset on the wire, for either domain.
func (c *Client) resetScans(ctx context.Context, project string, errs resetErrors) error {
	if project == "" {
		return fmt.Errorf("%w: project path is required", errs.refused)
	}

	if !c.generateLock.TryLock() {
		return errs.busy
	}
	defer c.generateLock.Unlock()

	body, err := json.Marshal(struct {
		Project string `json:"project"`
	}{project})
	if err != nil {
		return fmt.Errorf("amcworker: encode reset request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/scans/reset", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("amcworker: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("amcworker: %w", err)
		}
		return fmt.Errorf("%w: %v", errs.unavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// The reply is a short JSON acknowledgement.
	const maxRead = 1 << 20
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxRead))
	if err != nil {
		return fmt.Errorf("%w: read response: %v", errs.unavailable, err)
	}
	if resp.StatusCode != http.StatusOK {
		var payload workerError
		if jerr := json.Unmarshal(respBody, &payload); jerr == nil && payload.Error != "" {
			return errs.refusal(resp.StatusCode, payload.Error, payload.Detail)
		}
		return errs.refusal(resp.StatusCode, truncateForLog(respBody), "")
	}
	return nil
}
