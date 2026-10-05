package survey

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// The survey Kinds' handler factories (ADR-0079): they live in the owning
// domain, never in controls. Each turns domain sentinels into a
// jobs.Failure whose Message the run page's banner shows; Detail is debug
// only — never rendered, so it may carry the worker's English.

// RunPayload is what a survey run's job carries: the survey the run
// belongs to (the job's subject id is the run's). The run is re-read from
// the store, so a payload can never disagree with the row.
type RunPayload struct {
	SurveyID int64 `json:"survey_id"`
	// Batch is the uploaded file a survey_analyse reads (issue #311),
	// e.g. "batch-2.pdf"; empty on every other kind.
	Batch string `json:"batch,omitempty"`
}

// EncodeRunPayload is the payload Submit stores for a run's job.
func EncodeRunPayload(surveyID int64) []byte {
	b, _ := json.Marshal(RunPayload{SurveyID: surveyID})
	return b
}

// EncodeAnalysePayload is the payload of a run's survey_analyse.
func EncodeAnalysePayload(surveyID int64, batch string) []byte {
	b, _ := json.Marshal(RunPayload{SurveyID: surveyID, Batch: batch})
	return b
}

// NewAnalyseHandler is the `survey_analyse` job: AnalyzeBatch (issue #311).
// A done job's notice says what the batch read; every failure leaves the
// uploaded batch where it is (apps/server/CLAUDE.md, #210).
func NewAnalyseHandler(s *Service) jobs.Handler {
	return func(ctx context.Context, subjectID string, payload []byte) error {
		runID, surveyID, err := DecodeRunJob(subjectID, payload)
		var p RunPayload
		if err == nil {
			err = json.Unmarshal(payload, &p)
		}
		if err == nil && p.Batch == "" {
			err = fmt.Errorf("survey run %d analyse payload names no batch", runID)
		}
		if err != nil {
			return &jobs.Failure{Message: "No se pudo leer el trabajo de la pasada.", Detail: err.Error()}
		}
		result, err := s.AnalyzeBatch(ctx, surveyID, runID, p.Batch)
		switch {
		case err == nil:
			return &jobs.Notice{Message: result.Notice()}
		case errors.Is(err, ErrNothingCaptured):
			return &jobs.Failure{
				Message: "Ninguna página de ese PDF es de esta pasada: revisa que sean sus hojas.",
				Detail:  err.Error(),
			}
		case errors.Is(err, ErrReportMismatch):
			return &jobs.Failure{
				Message: "La lectura no coincide con la hoja de esta pasada; no se guardó nada.",
				Detail:  err.Error(),
			}
		case errors.Is(err, ErrAnalyzerRefused):
			return &jobs.Failure{Message: "El lector rechazó el lote escaneado.", Detail: err.Error()}
		case errors.Is(err, ErrAnalyzerUnavailable):
			return &jobs.Failure{
				Message: "El lector de escaneos no responde. Vuelve a intentarlo en unos minutos.",
				Detail:  err.Error(),
			}
		case errors.Is(err, ErrRunNotOpen):
			return &jobs.Failure{Message: "La pasada ya no está abierta: el lote no se leyó.", Detail: err.Error()}
		case errors.Is(err, ErrRunNotFound):
			return &jobs.Failure{Message: "Esa pasada ya no existe.", Detail: err.Error()}
		default:
			return &jobs.Failure{Message: "No se pudieron leer los escaneos.", Detail: err.Error()}
		}
	}
}

// NewGenerateHandler is the `survey_generate` job: GenerateRunSheet.
func NewGenerateHandler(s *Service) jobs.Handler {
	return func(ctx context.Context, subjectID string, payload []byte) error {
		runID, surveyID, err := DecodeRunJob(subjectID, payload)
		if err != nil {
			return &jobs.Failure{Message: "No se pudo leer el trabajo de la pasada.", Detail: err.Error()}
		}
		err = s.GenerateRunSheet(ctx, surveyID, runID)
		switch {
		case err == nil:
			return nil
		case errors.Is(err, ErrGeneratorRefused):
			return &jobs.Failure{
				Message: "El generador rechazó la hoja de la encuesta.",
				Detail:  err.Error(),
			}
		case errors.Is(err, ErrGeneratorUnavailable):
			return &jobs.Failure{
				Message: "El generador de PDF no responde. Vuelve a intentarlo en unos minutos.",
				Detail:  err.Error(),
			}
		case errors.Is(err, ErrRunNotFound):
			return &jobs.Failure{Message: "Esa pasada ya no existe.", Detail: err.Error()}
		default:
			return &jobs.Failure{Message: "No se pudo generar el PDF de la pasada.", Detail: err.Error()}
		}
	}
}

// DecodeRunJob reads a survey run job's subject id and payload back into
// the run and its survey — the one reader of the payload's contract, for
// the job handlers and for the page a job's banner lands on.
func DecodeRunJob(subjectID string, payload []byte) (runID, surveyID int64, err error) {
	runID, err = strconv.ParseInt(subjectID, 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("survey run id %q: %w", subjectID, err)
	}
	var p RunPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return 0, 0, fmt.Errorf("survey run %d payload: %w", runID, err)
	}
	if p.SurveyID <= 0 {
		return 0, 0, fmt.Errorf("survey run %d payload names no survey", runID)
	}
	return runID, p.SurveyID, nil
}
