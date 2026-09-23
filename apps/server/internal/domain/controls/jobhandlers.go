package controls

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// This file wires controls.Service methods into jobs.Handler factories,
// one per Kind. Handlers unmarshal the payload the HTTP surface
// serialised at Submit time, delegate to the Service, and translate a
// domain error into the (message, detail) pair the runner records —
// the short message reaches the banner (view.JobBanner.Error), the
// long detail stays on the job row for a future debug view.
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
// (banner-message, debug-detail) pair the runner records: the
// professor sees the short verdict on the banner and the long AMC line
// stays in the DB for a future consumer that needs it.
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

// PublishPayload is what the /publish and /test-send handlers serialise
// before Submit (issue #273).
//
// ProfessorID rides on the payload rather than being read from the control
// row, because the sender is whoever pressed the button and not
// control.CreatedBy: it is their consent, their address and their Sent
// folder. By the time the runner picks the job up the request is gone, so
// the id has to travel.
type PublishPayload struct {
	ProfessorID int64  `json:"professor_id"`
	Mode        string `json:"mode"`
	// TestTo empty means a real publication; set means a rehearsal to that
	// one address, which stamps nothing.
	TestTo string `json:"test_to"`
}

// NewPublishHandler returns the jobs.Handler for KindPublish.
func NewPublishHandler(svc *Service) jobs.Handler {
	if svc == nil {
		panic("controls.NewPublishHandler: no service")
	}
	return func(ctx context.Context, controlID string, raw []byte) error {
		var p PublishPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			// The raw error goes to the log, not the row: since #297 a
			// publication's detail is rendered on the banner.
			svc.Log.Error("controls: unreadable publish payload",
				"control", controlID, "error", err)
			return &jobs.Failure{
				Message: "no se pudo leer el trabajo de publicación",
				Detail:  "Vuelve a apretar el botón que usaste para enviarlas.",
			}
		}

		result, err := svc.Publish(ctx, controlID, PublishRequest{
			ProfessorID: p.ProfessorID,
			Mode:        PublishMode(p.Mode),
			TestTo:      p.TestTo,
		})
		if err != nil {
			return failureFromPublishError(svc, controlID, p, result, err)
		}
		if len(result.Failures) > 0 {
			// A PARTIAL run is reported as a failure, and that is the
			// decision worth stating. The control is stamped published and
			// most students have their correction — so this is not a
			// failure in the sense the other four Kinds mean. But the
			// banner is the only place a professor would ever learn that
			// three people got nothing, and a "listo" over three silent
			// omissions is the outcome this whole WP exists to avoid.
			return &jobs.Failure{
				Message: publishSummary(result),
				Detail:  publishDetail(result),
			}
		}
		return nil
	}
}

// publishSummary is the one line the banner renders.
//
// It names EVERY outcome the run produced, not only the sends. A resume
// that writes to nobody is a finished job, and "se enviaron 0 correcciones
// y 0 fallaron" reads as a broken one — which is what made the staging bug
// (#287 review, COR-1) silent rather than loud. AlreadySent and Skipped
// were both computed and surfaced nowhere, which is the same defect issue
// #287 opens by naming about Skipped.
//
// Zero terms are omitted rather than printed: "y 0 fallaron" on a clean run
// invites the professor to look for a failure there is none of.
func publishSummary(r PublishResult) string {
	// Every term agrees in number, like the three sibling functions on the
	// publication screens. "1 se omitieron" is the kind of string a
	// professor reads as a bug in the count (#287 review, COR-10).
	parts := []string{plural(r.Sent, "se envió 1 corrección", "se enviaron %d correcciones")}
	if r.AlreadySent > 0 {
		parts = append(parts, plural(r.AlreadySent, "1 ya estaba al día", "%d ya estaban al día"))
	}
	if r.Skipped > 0 {
		parts = append(parts, plural(r.Skipped, "1 se omitió", "%d se omitieron"))
	}
	if len(r.Failures) > 0 {
		parts = append(parts, plural(len(r.Failures), "1 falló", "%d fallaron"))
	}
	if len(parts) == 1 {
		return parts[0]
	}
	return strings.Join(parts[:len(parts)-1], ", ") + " y " + parts[len(parts)-1]
}

// plural picks the singular sentence or formats the plural one.
//
// Spanish, in the domain, for the same reason publishFailureReason is: the
// banner's text is assembled here, and splitting the number agreement from
// the sentence it agrees with would put one fact in two packages.
func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return fmt.Sprintf(many, n)
}

// publishDetail lists the copies that did not go out, so the professor
// knows WHICH ones to chase. Copy numbers only — never an address:
// docs/security-notes.md §"Logs and personal data", and this string is
// stored on the job row.
func publishDetail(r PublishResult) string {
	lines := make([]string, 0, len(r.Failures))
	for _, f := range r.Failures {
		lines = append(lines, fmt.Sprintf("copia %d: %s", f.CopyNumber, f.Reason))
	}
	return strings.Join(lines, "\n")
}

// credentialLostFailure words a publication whose Gmail credential died
// mid-run (issue #297): ONE message for the whole run, since the fault is
// the professor's connection and not any copy.
//
// The message counts what went out first, because the next Publicar
// resumes from exactly there (ADR-0073) and the professor should know
// whether they are finishing a publication or starting one. The detail is
// the repair. Any copy that failed for its OWN reasons before the
// credential died keeps its line under it — that one is still a copy's
// problem, and a resume will retry it.
//
// The repair names the button the professor actually pressed (#297
// review, COR-2). A REHEARSAL — an Envío de prueba, or Publicar in
// `staging` — stamps nothing, so "only the unsent copies will go" is false
// for it; and sending someone who was rehearsing to plain Publicar sends
// them to the button that mails the real class.
//
// An accepted gap: a `real` run under a deployment-wide REDIRECTING
// transport (NALANDA_EMAIL_MODE=staging) also stamps nothing, and gets the
// real-run wording, whose "only the unsent copies" half is then false. It
// costs nothing — under that transport no student is written to by any
// press — so the payload's two fields decide, not the dispatcher.
func credentialLostFailure(p PublishPayload, r PublishResult) *jobs.Failure {
	sent := "no se envió ninguna corrección"
	if r.Sent > 0 {
		sent = plural(r.Sent, "alcanzó a salir 1 corrección", "alcanzaron a salir %d correcciones")
	}
	var repair string
	switch {
	case p.TestTo != "":
		repair = "Vuelve a conectarla en tu perfil y repite el envío de prueba."
	case PublishMode(p.Mode) == PublishModeStaging:
		repair = "Vuelve a conectarla en tu perfil y publica otra vez con " +
			"«mi propia dirección (prueba)»."
	default:
		repair = "Vuelve a conectarla en tu perfil y aprieta Publicar otra vez: sólo se " +
			"enviará a quienes todavía no recibieron su corrección."
	}
	detail := "Google dejó de aceptar tu cuenta. " + repair
	if len(r.Failures) > 0 {
		detail += "\n\n" + publishDetail(r)
	}
	return &jobs.Failure{
		Message: "se perdió la conexión con Gmail: " + sent,
		Detail:  detail,
	}
}

// failureFromPublishError words the errors that stop a publication. Each
// one has a different repair, so each gets its own sentence — a single "no
// se pudo publicar" would send the professor looking in the wrong place.
//
// Every Detail here is Spanish written for the professor, and that is now
// load-bearing: since #297 the control page RENDERS a failed publication's
// detail (#297 review, ARQ-1/SEC-1). The default branch logs the raw error
// rather than storing it.
func failureFromPublishError(svc *Service, controlID string, p PublishPayload, r PublishResult, err error) error {
	switch {
	case errors.Is(err, ErrCredentialLost):
		// FIRST, because it wraps gmail.ErrNotConnected and the next case
		// would tell a professor whose connection just died that they never
		// made one.
		return credentialLostFailure(p, r)
	case errors.Is(err, gmail.ErrNotConnected):
		return &jobs.Failure{
			Message: "no hay una cuenta de Gmail conectada",
			Detail:  "Conéctala en tu perfil antes de publicar.",
		}
	case errors.Is(err, ErrNotGraded):
		return &jobs.Failure{
			Message: "la corrección todavía no está cerrada",
			Detail:  "Cierra la corrección antes de publicar.",
		}
	case errors.Is(err, ErrNoCourse):
		return &jobs.Failure{
			Message: "este control no está asignado a un curso",
			Detail:  "Asígnale un curso para saber a quién enviarle las correcciones.",
		}
	case errors.Is(err, ErrCannotDeliver):
		return &jobs.Failure{
			Message: "este servidor no está configurado para enviar correo",
			Detail: "NALANDA_EMAIL_MODE no está en `real`, así que no se envió nada y el " +
				"control quedó sin publicar.",
		}
	default:
		svc.Log.Error("controls: publication failed",
			"control", controlID, "error", err)
		return &jobs.Failure{
			Message: "no se pudo publicar",
			Detail: "Algo falló en el servidor y el envío se detuvo. Vuelve a intentarlo en " +
				"unos minutos; si se repite, avisa a quien administra el servidor.",
		}
	}
}
