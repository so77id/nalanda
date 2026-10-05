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
}

// EncodeRunPayload is the payload Submit stores for a run's job.
func EncodeRunPayload(surveyID int64) []byte {
	b, _ := json.Marshal(RunPayload{SurveyID: surveyID})
	return b
}

// NewGenerateHandler is the `survey_generate` job: GenerateRunSheet.
func NewGenerateHandler(s *Service) jobs.Handler {
	return func(ctx context.Context, subjectID string, payload []byte) error {
		runID, surveyID, err := decodeRunJob(subjectID, payload)
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

func decodeRunJob(subjectID string, payload []byte) (runID, surveyID int64, err error) {
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
