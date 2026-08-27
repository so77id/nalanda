package controls

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// This file wires controls.Service methods into jobs.Handler factories,
// one per Kind. Handlers unmarshal the payload the HTTP surface
// serialised at Submit time, delegate to the Service, and translate a
// domain error into the (message, detail) pair the runner records —
// so the banner surfaces exactly what refusedFlash would have surfaced
// on the sync path (scans.go).
//
// The payload types live here rather than in a sibling package because
// they belong to the domain call: a change to Reanalyze's signature is
// the same change to ReanalysePayload.

// ReanalysePayload is what the /reanalyze handler serialises before
// Submit. Ticked/Unsure are the thresholds the runner will re-read at.
type ReanalysePayload struct {
	Ticked float64 `json:"ticked"`
	Unsure float64 `json:"unsure"`
}

// NewReanalyseHandler returns the jobs.Handler for KindReanalyse.
// controlID comes from the job row; payload is the JSON-marshalled
// ReanalysePayload the HTTP handler produced.
func NewReanalyseHandler(svc *Service) jobs.Handler {
	if svc == nil {
		panic("controls.NewReanalyseHandler: no service")
	}
	return func(ctx context.Context, controlID string, raw []byte) error {
		var p ReanalysePayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return &jobs.Failure{
				Message: "no se pudo leer el trabajo de re-lectura",
				Detail:  fmt.Sprintf("unmarshal payload: %v", err),
			}
		}
		if _, err := svc.Reanalyze(ctx, controlID, p.Ticked, p.Unsure); err != nil {
			return failureFromAnalyzeError(err)
		}
		return nil
	}
}

// failureFromAnalyzeError translates a controls.Service error into the
// (banner-message, debug-detail) pair the runner records. Same shape as
// refusedFlash in the sync path (scans.go): the professor sees the
// short verdict on the banner and the long AMC line stays in the DB
// for a future consumer that needs it.
func failureFromAnalyzeError(err error) error {
	if err == nil {
		return nil
	}
	// A refused error carries a short Message + a long Detail — the
	// two fields the flash cookie already splits on. Split them the
	// same way onto the job row.
	var refused *AnalyzerRefusedError
	if errors.As(err, &refused) && refused != nil {
		msg := refused.Message
		if msg == "" {
			msg = "el motor de lectura rechazó el trabajo"
		}
		return &jobs.Failure{Message: msg, Detail: refused.Detail}
	}
	switch {
	case errors.Is(err, ErrControlNotFound):
		return &jobs.Failure{Message: "ese control ya no existe", Detail: err.Error()}
	case errors.Is(err, ErrAnalyzerRefused):
		return &jobs.Failure{Message: "el motor de lectura rechazó el trabajo", Detail: err.Error()}
	case errors.Is(err, ErrAnalyzerUnavailable):
		return &jobs.Failure{Message: "el motor de lectura no está disponible", Detail: err.Error()}
	}
	// Anything else — a store outage, a coding bug — carries the
	// technical message on the banner: the professor sees "algo se
	// rompió" text elsewhere already, and a specific technical string
	// here helps operator triage.
	return &jobs.Failure{Message: err.Error(), Detail: ""}
}
