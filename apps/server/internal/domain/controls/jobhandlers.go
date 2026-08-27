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

// AnalysePayload is what the /scans handler serialises before Submit
// (issue #249, S4). BatchName is the name of the uploaded PDF the
// runner points AMC at; Ticked/Unsure are the thresholds the reader
// runs at. The HTTP handler wrote the file to disk synchronously
// before enqueuing — SaveUploadedBatch returns these three values.
type AnalysePayload struct {
	BatchName string  `json:"batch_name"`
	Ticked    float64 `json:"ticked"`
	Unsure    float64 `json:"unsure"`
}

// EmptyPayload is the literal `{}` bytes the KindGenerate and
// KindAnnotate submissions carry — both handlers ignore the payload
// (their async methods read the control row for what they need).
// Kept as a package-level constant so the two call sites share the
// literal and a reader sees why nothing rides on the wire.
var EmptyPayload = []byte("{}")

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

// NewAnalyseHandler returns the jobs.Handler for KindAnalyse (issue
// #249, S4). controlID comes from the job row; payload is the
// JSON-marshalled AnalysePayload the HTTP handler produced.
func NewAnalyseHandler(svc *Service) jobs.Handler {
	if svc == nil {
		panic("controls.NewAnalyseHandler: no service")
	}
	return func(ctx context.Context, controlID string, raw []byte) error {
		var p AnalysePayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return &jobs.Failure{
				Message: "no se pudo leer el trabajo de análisis",
				Detail:  fmt.Sprintf("unmarshal payload: %v", err),
			}
		}
		if _, err := svc.AnalyzeBatch(ctx, controlID, p.BatchName, p.Ticked, p.Unsure); err != nil {
			return failureFromAnalyzeError(err)
		}
		return nil
	}
}

// NewGenerateHandler returns the jobs.Handler for KindGenerate (issue
// #249, S5). Payload is empty — the async GenerateAssets reads the
// control row for what it needs.
func NewGenerateHandler(svc *Service) jobs.Handler {
	if svc == nil {
		panic("controls.NewGenerateHandler: no service")
	}
	return func(ctx context.Context, controlID string, _ []byte) error {
		if err := svc.GenerateAssets(ctx, controlID); err != nil {
			return failureFromGenerateError(err)
		}
		return nil
	}
}

// NewAnnotateHandler returns the jobs.Handler for KindAnnotate (issue
// #249, S6). Called when the professor closes the correction — a
// defensive re-annotate pass over every ok copy, so a control that
// was analysed while AnnotateEnabled was false gets its PDFs on
// close. A no-op when every ok copy is already annotated.
func NewAnnotateHandler(svc *Service) jobs.Handler {
	if svc == nil {
		panic("controls.NewAnnotateHandler: no service")
	}
	return func(ctx context.Context, controlID string, _ []byte) error {
		if err := svc.AnnotateAllCleanCopies(ctx, controlID); err != nil {
			// AnnotateAllCleanCopies logs per-copy failures and never
			// propagates them (annotate is best-effort — the professor
			// can retry per copy from review). Anything reaching here
			// is a whole-flow failure (control not found, store outage).
			return &jobs.Failure{Message: err.Error()}
		}
		return nil
	}
}

// failureFromGenerateError translates a Service.GenerateAssets error
// into the (banner, debug) pair. Same split shape as
// failureFromAnalyzeError; kept separate because the sentinel set is
// different (ErrGeneratorRefused / ErrGeneratorUnavailable /
// ErrSujetMissing).
func failureFromGenerateError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, ErrControlNotFound):
		return &jobs.Failure{Message: "ese control ya no existe", Detail: err.Error()}
	case errors.Is(err, ErrGeneratorRefused):
		return &jobs.Failure{Message: "el motor rechazó la generación", Detail: err.Error()}
	case errors.Is(err, ErrGeneratorUnavailable):
		return &jobs.Failure{Message: "el motor no está disponible", Detail: err.Error()}
	case errors.Is(err, ErrSujetMissing):
		return &jobs.Failure{Message: "la generación no produjo un sujet.pdf válido", Detail: err.Error()}
	}
	return &jobs.Failure{Message: err.Error(), Detail: ""}
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
