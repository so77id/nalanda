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

// AnnotateCopy runs POST /annotate/copy against the worker and returns the
// produced PDF's path relative to the shared volume. Serialised behind the
// same mutex as Generate and Analyze: AMC's state is sqlite in the project
// directory and two runs against one project would race it (ADR-0030).
func (c *Client) AnnotateCopy(ctx context.Context, req controls.AnnotateRequest) (string, error) {
	if req.Project == "" {
		return "", fmt.Errorf("%w: project path is required", controls.ErrAnnotatorRefused)
	}
	if req.Copy < 1 {
		return "", fmt.Errorf("%w: copy must be at least 1, got %d", controls.ErrAnnotatorRefused, req.Copy)
	}

	c.generateLock.Lock()
	defer c.generateLock.Unlock()

	body, err := json.Marshal(annotateRequestBody{
		Project:   req.Project,
		Copy:      req.Copy,
		Overrides: toWireOverrides(req.Overrides),
	})
	if err != nil {
		return "", fmt.Errorf("amcworker: encode annotate request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/annotate/copy", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("amcworker: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "", fmt.Errorf("amcworker: %w", err)
		}
		return "", fmt.Errorf("%w: %v", controls.ErrAnnotatorUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// The reply is a path and a copy number — bytes, not megabytes.
	const maxRead = 1 << 20
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxRead))
	if err != nil {
		return "", fmt.Errorf("%w: read response: %v", controls.ErrAnnotatorUnavailable, err)
	}

	if resp.StatusCode != http.StatusOK {
		var payload workerError
		if jerr := json.Unmarshal(respBody, &payload); jerr == nil && payload.Error != "" {
			return "", fmt.Errorf("%w: worker answered %d: %s",
				controls.ErrAnnotatorRefused, resp.StatusCode, payload.Error)
		}
		return "", fmt.Errorf("%w: worker answered %d: %s",
			controls.ErrAnnotatorRefused, resp.StatusCode, truncateForLog(respBody))
	}

	var payload annotateResponseBody
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return "", fmt.Errorf("%w: decode response: %v", controls.ErrAnnotatorRefused, err)
	}
	// The wire-level completeness checks stay here, on the wire type —
	// same reasoning as Generate's (properties of the response, not of the
	// domain). A missing path or a mismatched copy is a refusal.
	if payload.Path == "" {
		return "", fmt.Errorf("%w: worker returned an incomplete response: %+v",
			controls.ErrAnnotatorRefused, payload)
	}
	if payload.Copy != req.Copy {
		return "", fmt.Errorf("%w: worker annotated copy %d, asked for %d",
			controls.ErrAnnotatorRefused, payload.Copy, req.Copy)
	}
	return payload.Path, nil
}

// Assert the interface at compile time.
var _ controls.Annotator = (*Client)(nil)

// --- wire shapes -------------------------------------------------------------

type annotateRequestBody struct {
	Project   string                 `json:"project"`
	Copy      int                    `json:"copy"`
	Overrides *annotateOverridesBody `json:"overrides,omitempty"`
}

type annotateOverridesBody struct {
	RUT     *string              `json:"rut,omitempty"`
	Answers []annotateAnswerBody `json:"answers,omitempty"`
}

type annotateAnswerBody struct {
	Question string `json:"question"`
	Marked   []int  `json:"marked"`
}

type annotateResponseBody struct {
	Path string `json:"path"`
	Copy int    `json:"copy"`
}

// toWireOverrides returns nil when the professor changed nothing, so the
// request omits the key entirely and the worker annotates what AMC read.
func toWireOverrides(o controls.AnnotateOverrides) *annotateOverridesBody {
	if o.RUT == nil && len(o.Answers) == 0 {
		return nil
	}
	out := &annotateOverridesBody{}
	if o.RUT != nil {
		rut := *o.RUT
		out.RUT = &rut
	}
	for _, a := range o.Answers {
		// Non-nil on the wire: the worker contract spells a blank override
		// as [] — a nil slice would marshal to null and the worker used to
		// read that as a malformed field (issue #190 review, blocker 1).
		marked := a.Marked
		if marked == nil {
			marked = []int{}
		}
		out.Answers = append(out.Answers, annotateAnswerBody{
			Question: a.Question,
			Marked:   marked,
		})
	}
	return out
}
