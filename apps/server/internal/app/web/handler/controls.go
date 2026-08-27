package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls/stats"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The controls routes (issue #166 §The screens). URL paths in English like
// every other route in this surface (issue #151 §Routes). WP-F extends the
// set with the scan-upload target (ControlScansPath in scans.go).
const (
	ControlsPath        = "/controls"
	ControlsNewPath     = "/controls/new"
	ControlDetailPath   = "/controls/{id}"
	ControlSujetPath    = "/controls/{id}/sujet.pdf"
	ControlCorrigePath  = "/controls/{id}/corrige.pdf"
	ControlPoolJSONPath = "/controls/{id}/pool.json"
	// ControlUploadPath serves an uploaded scan batch (issue #204).
	ControlUploadPath = "/controls/{id}/uploads/{batch}"
)

// Defaults for the form fields. §C17: a control is four questions under a
// five-minute clock. 30 copies is a reasonable class size.
const (
	defaultQuestionsPerCopy = 4
	defaultCopies           = 30
	maxQuestionsPerCopy     = 20
	maxCopies               = 300
	maxNameLength           = 100
	minNameLength           = 3
)

// Controls holds the CRUD's handlers. Same shape as Professors, same
// reasoning: several handlers sharing dependencies, refused when the set
// is incomplete so a wiring mistake is a panic at boot rather than a nil
// dereference inside a request (backend-code-style.md §Errors).
//
// Only Service is here on the domain side — reads and writes both go
// through it (WP-E review, ARQ-11: the earlier shape held both Service
// and Store and reviewers could not tell which was canonical for reads).
type Controls struct {
	Service *controls.Service
	// Bank is the live wrapper around the published question bank
	// (ADR-0032, issue #230). Handler methods call h.Bank.Get() to pick
	// up the current snapshot; each call resolves independently, so a
	// Reload landing mid-request may leave the handler and the service
	// looking at different snapshots. The failure mode is small — a
	// picker validation against snapshot A followed by a pool draw
	// against snapshot B — and no worse than any other read against a
	// slowly-changing store. The atomic-swap guarantee is per-call
	// atomicity, not request-level; the WP review of #230 pinned that
	// distinction (IMPORTANT-3) rather than let this comment overclaim.
	Bank      *bank.LiveBank
	PublicURL string
	// MaxScanBytes is the largest scan upload the handler accepts. Comes
	// from config.MaxScanBytes so main is the only place the byte value
	// is composed (backend-code-style.md §Configuration).
	MaxScanBytes int64
	// OnCorrectionClosed fires after a correction moves to Graded
	// (issue #190 §Hook para futuros integraciones). Required — the
	// default is controls.NewNoopHook, wired in cmd/server.
	OnCorrectionClosed controls.OnCorrectionClosed
	// Jobs is the async job runner's store (issue #249). Detail reads
	// the latest job for the banner; DismissJob writes viewed_at.
	Jobs jobs.Store
	// Runner submits async jobs (issue #249). Handlers migrated to the
	// runner call it here instead of the sync Service method.
	Runner *jobs.Runner
	Log    *slog.Logger

	secureCookie bool
}

// NewControls returns the handlers.
func NewControls(deps Controls) *Controls {
	switch {
	case deps.Service == nil:
		panic("handler.NewControls: no service")
	case deps.Bank == nil:
		panic("handler.NewControls: no bank")
	case deps.PublicURL == "":
		panic("handler.NewControls: no public URL — the flash cookie's Secure attribute is derived from it")
	case deps.OnCorrectionClosed == nil:
		panic("handler.NewControls: no correction-closed hook — pass controls.NewNoopHook(log)")
	case deps.Jobs == nil:
		panic("handler.NewControls: no jobs store")
	case deps.Runner == nil:
		panic("handler.NewControls: no jobs runner")
	case deps.Log == nil:
		panic("handler.NewControls: no logger")
	}
	deps.secureCookie = config.SecureFor(deps.PublicURL)
	return &deps
}

// List renders every control the service returns, ordered as the store
// promises (application_date desc, nulls last).
func (h *Controls) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Service.List(r.Context())
	if err != nil {
		h.Log.Error("listing controls", "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	page := view.ControlsListPage{
		Page:     middleware.PageFor(r, "Controles"),
		Controls: h.toListedControls(rows),
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)

	if err := view.RenderControlsList(w, page); err != nil {
		h.Log.Error("rendering the controls list", "error", err)
	}
}

// New renders the empty create form.
func (h *Controls) New(w http.ResponseWriter, r *http.Request) {
	page := h.newFormPage(r, defaultFormValues(), nil, "")
	if err := view.RenderControlsForm(w, http.StatusOK, page); err != nil {
		h.Log.Error("rendering the controls create form", "error", err)
	}
}

// Create validates the form, orchestrates via the Service, flashes and
// redirects on success or re-renders with per-field errors on refusal.
func (h *Controls) Create(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		h.rerenderNew(w, r, defaultFormValues(), nil,
			"No se pudo leer el formulario. Inténtalo de nuevo.")
		return
	}

	values := valuesFromRequest(r)
	errs, req := validateCreate(values, h.Bank.Get())
	if len(errs) > 0 {
		h.rerenderNew(w, r, values, errs, "")
		return
	}

	acting, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		// The gate would have redirected an anonymous request; keep the
		// branch honest.
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	req.CreatedBy = acting.ID

	// Issue #249, S5: split the sync half (files staged + row committed)
	// from the async half (worker call). The professor lands on the
	// detail page immediately with a "Generando…" banner from the
	// generate job; the row is safe for the sync-path validations
	// (domain errors like a too-small pool still surface as form
	// errors), and the worker outage is asynchronously visible on the
	// banner rather than a 30-second-long POST.
	control, err := h.Service.PrepareControl(r.Context(), req)
	if err != nil {
		fieldErr, ok := domainErrorToForm(err)
		if !ok {
			h.Log.Error("creating a control", "error", err, "professor", acting.ID)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El servidor no pudo preparar el control. Vuelve a intentarlo en unos minutos; si el problema persiste, avisa a alguien de infraestructura.")
			return
		}
		h.rerenderNew(w, r, values, fieldErr, "")
		return
	}
	payload, err := json.Marshal(controls.GeneratePayload{})
	if err != nil {
		h.Log.Error("controls: encode generate payload", "control", control.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo encolar la generación.")
		return
	}
	if _, err := h.Runner.Submit(r.Context(), control.ID, jobs.KindGenerate, payload); err != nil {
		h.Log.Error("controls: submit generate job", "control", control.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"El servidor no pudo encolar la generación.")
		return
	}
	flash.Set(w, h.secureCookie,
		"Control «"+control.Name+"» encolado para generación. Refresca cuando el aviso cambie.")
	http.Redirect(w, r, controlDetailURL(control.ID), http.StatusSeeOther)
}

// Detail renders one control (S8).
func (h *Controls) Detail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}
	c, err := h.Service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return
		}
		h.Log.Error("reading a control", "error", err, "id", id)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	uploads, err := h.Service.UploadList(id)
	if err != nil {
		h.Log.Error("listing upload batches", "control", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	page := view.ControlDetailPage{
		Page:         middleware.PageFor(r, c.Name),
		Control:      toDetailedControl(c, h.Bank.Get()),
		SujetURL:     controlSujetURL(c.ID),
		CorrigeURL:   controlCorrigeURL(c.ID),
		PoolJSONURL:  controlPoolJSONURL(c.ID),
		ScansURL:     controlScansURL(c.ID),
		ReanalyzeURL: controlReanalyzeURL(c.ID),
		CloseURL:     controlCloseURL(c.ID),
		MaxScanMB:    h.MaxScanBytes >> 20,
		// Issue #197: the pair the control was last read at — the prefill
		// for both threshold forms and the "umbral actual" line.
		CurrentTicked: c.Ticked,
		CurrentUnsure: c.Unsure,
		Graded:        c.State == controls.Graded,
	}
	for _, name := range uploads {
		page.Uploads = append(page.Uploads, view.UploadedBatch{
			Name: name,
			URL:  controlUploadURL(id, name),
		})
	}
	readings, err := h.Service.ReadingsFor(r.Context(), c.ID)
	if err != nil {
		h.Log.Error("listing readings", "control", c.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	if len(readings) > 0 {
		page.QuestionColumns = perQuestionColumns(c.QuestionsPerCopy)
		page.Readings = toReadingRows(c, readings)
		page.Summary = summarise(readings)
		page.CanClose, page.CloseBlockedReason = closeGate(c, readings)
	}
	// Issue #251: the stats panel is gated on Graded + at least one
	// reading. A pure read from the domain — no writes, no worker call,
	// no cache. Compute walks the readings again per request; the panel
	// is server-rendered and a graded control's readings do not change
	// between requests, so the cost is proportional to N and small.
	if c.State == controls.Graded && len(readings) > 0 {
		computed := stats.Compute(readings, h.Bank.Get(), c.QuestionsPerCopy)
		if computed.Global.N > 0 {
			page.Stats = &computed
		}
	}
	page.JobBanner = h.jobBannerFor(r.Context(), c.ID)
	page.Flash = flash.Consume(w, r, h.secureCookie)

	if err := view.RenderControlDetail(w, page); err != nil {
		h.Log.Error("rendering the control detail", "error", err)
	}
}

// SujetPDF, CorrigePDF and PoolJSON stream the control's files from the
// shared volume. Paths are computed through the Service's wrote-through
// helpers so a caller cannot accidentally hand back something outside the
// control's own directory.
func (h *Controls) SujetPDF(w http.ResponseWriter, r *http.Request) {
	h.serveControlFile(w, r, h.Service.SujetPath, "sujet.pdf", "application/pdf", "inline",
		"El PDF del control no está disponible. Puede que se haya limpiado del volumen compartido.")
}

func (h *Controls) CorrigePDF(w http.ResponseWriter, r *http.Request) {
	h.serveControlFile(w, r, h.Service.CorrigePath, "corrige.pdf", "application/pdf", "inline",
		"El PDF del control no está disponible. Puede que se haya limpiado del volumen compartido.")
}

// PoolJSON streams the pool snapshot written at Create time (issue #198).
// Attachment rather than inline: it is backup material, not a page.
func (h *Controls) PoolJSON(w http.ResponseWriter, r *http.Request) {
	h.serveControlFile(w, r, h.Service.PoolJSONPath, "pool.json", "application/json", "attachment",
		"El respaldo de preguntas del control no está disponible.")
}

func (h *Controls) serveControlFile(w http.ResponseWriter, r *http.Request, pathFor func(string) string, name, contentType, disposition, missingMsg string) {
	id := r.PathValue("id")
	if !isValidControlID(id) {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
		return
	}
	// A lookup rather than a bare filepath.Join(WorkDir, id): the row is
	// the authority, so a control that has no row cannot have its files
	// served either (auth's list-then-serve pattern applied here).
	if _, err := h.Service.Get(r.Context(), id); err != nil {
		if errors.Is(err, controls.ErrControlNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese control no existe.")
			return
		}
		h.Log.Error("reading a control for a file", "error", err, "id", id)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	path := pathFor(id)

	f, err := os.Open(path)
	if err != nil {
		h.Log.Warn("serving control file", "id", id, "name", name, "error", err)
		middleware.WriteError(w, r, http.StatusNotFound, missingMsg)
		return
	}
	defer func() { _ = f.Close() }()

	info, err := f.Stat()
	if err != nil {
		h.Log.Error("stat control file", "id", id, "name", name, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="control-%s-%s"`, disposition, id, name))
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// rerenderNew re-renders the form after a validation refusal (422).
func (h *Controls) rerenderNew(w http.ResponseWriter, r *http.Request, values view.ControlFormValues, errs map[string]string, notice string) {
	page := h.newFormPage(r, values, errs, notice)
	if err := view.RenderControlsForm(w, http.StatusUnprocessableEntity, page); err != nil {
		h.Log.Error("rendering the controls form after validation", "error", err)
	}
}

func (h *Controls) newFormPage(r *http.Request, values view.ControlFormValues, errs map[string]string, notice string) view.ControlsFormPage {
	return view.ControlsFormPage{
		Page:           middleware.PageFor(r, "Nuevo control"),
		Action:         ControlsPath,
		Submit:         "Generar control",
		Heading:        "Nuevo control",
		Values:         values,
		Errors:         errs,
		Notice:         notice,
		SectionOptions: sectionOptionsFromBank(h.Bank.Get()),
	}
}

// defaultFormValues returns the values the empty GET form starts from.
func defaultFormValues() view.ControlFormValues {
	return view.ControlFormValues{
		QuestionsPerCopy: strconv.Itoa(defaultQuestionsPerCopy),
		Copies:           strconv.Itoa(defaultCopies),
		// Historical AMC layout by default (issue #185): the professor
		// opts out for simplex printing.
		DuplexPadding: true,
		// Issue #208: Letter is the operational default (ADR-0043); A4
		// requires opening `<details> Opciones avanzadas` first.
		Paper: string(controls.DefaultPaper),
	}
}

// valuesFromRequest reads the form values on POST. Whitespace-trimmed and
// lowercased where a normalisation is safe.
func valuesFromRequest(r *http.Request) view.ControlFormValues {
	from := strings.TrimSpace(r.PostFormValue("from"))
	to := strings.TrimSpace(r.PostFormValue("to"))
	fromDoc, fromSec, _ := strings.Cut(from, ":")
	toDoc, toSec, _ := strings.Cut(to, ":")
	return view.ControlFormValues{
		Name:             strings.TrimSpace(r.PostFormValue("name")),
		ApplicationDate:  strings.TrimSpace(r.PostFormValue("application_date")),
		FromDocument:     fromDoc,
		FromSection:      fromSec,
		ToDocument:       toDoc,
		ToSection:        toSec,
		QuestionsPerCopy: strings.TrimSpace(r.PostFormValue("questions_per_copy")),
		Copies:           strings.TrimSpace(r.PostFormValue("copies")),
		// HTML checkbox convention: absent means unchecked. `on` is what
		// the browser sends when the checkbox has no explicit value.
		DuplexPadding: r.PostFormValue("duplex_padding") == "on",
		// Issue #208: read the radio verbatim. Empty means the professor
		// never opened `<details>` — validateCreate resolves that to the
		// default; anything outside {"letter","a4"} is refused there.
		Paper: strings.TrimSpace(r.PostFormValue("paper")),
	}
}

// validateCreate is the form's validation convention: field-keyed map,
// empty means valid. Also returns the parsed CreateRequest (populated
// only when the map is empty).
func validateCreate(v view.ControlFormValues, b *bank.Bank) (map[string]string, controls.CreateRequest) {
	errs := map[string]string{}

	if v.Name == "" {
		errs["name"] = "El nombre es obligatorio."
	} else if len([]rune(v.Name)) < minNameLength {
		errs["name"] = "El nombre debe tener al menos 3 caracteres."
	} else if len([]rune(v.Name)) > maxNameLength {
		errs["name"] = "El nombre debe tener a lo más 100 caracteres."
	}

	// application_date is optional: an empty string is valid and skips
	// the parse. A non-empty value that fails to parse is a per-field
	// refusal.
	var appDate *time.Time
	if v.ApplicationDate != "" {
		parsed, err := time.Parse("2006-01-02", v.ApplicationDate)
		if err != nil {
			errs["application_date"] = "La fecha no tiene la forma esperada (AAAA-MM-DD)."
		} else {
			appDate = &parsed
		}
	}

	from := bank.SectionRef{Document: v.FromDocument, Section: v.FromSection}
	to := bank.SectionRef{Document: v.ToDocument, Section: v.ToSection}
	if v.FromDocument == "" || v.FromSection == "" {
		errs["from"] = "Elige un inicio."
	} else if !b.HasSection(from) {
		errs["from"] = "Ese inicio no existe en el banco."
	}
	if v.ToDocument == "" || v.ToSection == "" {
		errs["to"] = "Elige un fin."
	} else if !b.HasSection(to) {
		errs["to"] = "Ese fin no existe en el banco."
	}

	qpc, qpcErr := parsePositive(v.QuestionsPerCopy, 1, maxQuestionsPerCopy)
	if qpcErr != "" {
		errs["questions_per_copy"] = qpcErr
	}
	copies, copiesErr := parsePositive(v.Copies, 1, maxCopies)
	if copiesErr != "" {
		errs["copies"] = copiesErr
	}

	// Issue #208: empty is the "professor never opened <details>" path,
	// resolved to the default. Anything else must be one of the two
	// enumerated values; a stray third string is refused here so the
	// schema CHECK never has to.
	paper := controls.Paper(v.Paper)
	if v.Paper == "" {
		paper = controls.DefaultPaper
	} else if !controls.ValidPaper(paper) {
		errs["paper"] = "El papel debe ser Letter o A4."
	}

	req := controls.CreateRequest{
		Name:             v.Name,
		ApplicationDate:  appDate,
		RangeFrom:        from,
		RangeTo:          to,
		QuestionsPerCopy: qpc,
		Copies:           copies,
		DuplexPadding:    v.DuplexPadding,
		Paper:            paper,
	}
	return errs, req
}

// parsePositive parses a positive integer in [min, max]. Empty is
// reported.
func parsePositive(raw string, min, max int) (int, string) {
	if raw == "" {
		return 0, fmt.Sprintf("Escribe un número entre %d y %d.", min, max)
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, "Debe ser un número entero."
	}
	if n < min || n > max {
		return 0, fmt.Sprintf("Debe estar entre %d y %d.", min, max)
	}
	return n, ""
}

// domainErrorToForm maps a Service.Create failure onto (field errors,
// ok). ok is false for errors the professor cannot repair; those bubble
// up as a 500 in Create.
func domainErrorToForm(err error) (map[string]string, bool) {
	switch {
	case errors.Is(err, bank.ErrRangeInverted):
		return map[string]string{"to": "El fin va antes que el inicio en el orden de lectura."}, true
	case errors.Is(err, bank.ErrEmptyRange):
		return map[string]string{"to": "El rango no tiene preguntas todavía."}, true
	case errors.Is(err, bank.ErrUnknownDocument), errors.Is(err, bank.ErrUnknownSection):
		return map[string]string{"from": "Ese rango no existe en el banco."}, true
	case errors.Is(err, controls.ErrPoolTooSmall):
		var pool controls.PoolTooSmallErr
		if errors.As(err, &pool) {
			return map[string]string{
				"questions_per_copy": fmt.Sprintf(
					"Pediste %d preguntas por copia, pero el rango solo tiene %d disponibles.",
					pool.QuestionsPerCopy, pool.Pool),
			}, true
		}
	}
	return nil, false
}

// sectionOptionsFromBank builds the range dropdowns from the bank, in
// reading order. The template decides which option is selected by
// comparing option.Value against the composite form value; no per-option
// flag is needed and no per-render state has to travel through here.
func sectionOptionsFromBank(b *bank.Bank) []view.DocumentSections {
	if b == nil {
		return nil
	}
	out := make([]view.DocumentSections, 0, len(b.Documents))
	for _, d := range b.Documents {
		sections := make([]view.SectionOption, 0, len(d.Sections))
		for _, s := range d.Sections {
			sections = append(sections, view.SectionOption{
				Value:   d.ID + ":" + s,
				Label:   s,
				Section: s,
			})
		}
		out = append(out, view.DocumentSections{
			DocumentID:    d.ID,
			DocumentTitle: d.Title,
			Sections:      sections,
		})
	}
	return out
}

// jobBannerFor composes the Detail page's async-job banner (issue #249)
// from the latest job on this control. Returns nil when there is no job
// at all, or when the most recent one is done|failed AND has been
// dismissed — the banner should hide, not tell the professor to
// dismiss a message they already saw. A store outage returns nil too:
// the banner is an aid, not a load-bearing part of the page, and a
// missing banner is better than a 500 on the whole detail.
func (h *Controls) jobBannerFor(ctx context.Context, controlID string) *view.JobBanner {
	job, err := h.Jobs.LatestForControl(ctx, controlID)
	if err != nil {
		if !errors.Is(err, jobs.ErrJobNotFound) {
			h.Log.Warn("jobs: reading banner", "control", controlID, "error", err)
		}
		return nil
	}
	running := job.Status == jobs.StatusQueued || job.Status == jobs.StatusRunning
	if !running && job.ViewedAt != nil {
		return nil
	}
	banner := &view.JobBanner{
		JobID:      job.ID,
		Kind:       spanishKind(job.Kind),
		Running:    running,
		Done:       job.Status == jobs.StatusDone,
		Failed:     job.Status == jobs.StatusFailed,
		Error:      job.Error,
		DismissURL: jobDismissURL(job.ID),
	}
	if running {
		start := job.CreatedAt
		if job.StartedAt != nil {
			start = *job.StartedAt
		}
		banner.StartedAgo = humanElapsed(time.Since(start))
	}
	return banner
}

// spanishKind is the human label the banner renders for a Kind.
// Kept next to the field it decorates rather than in the view package
// because the four values are handler-facing translation, not layout.
func spanishKind(k jobs.Kind) string {
	switch k {
	case jobs.KindGenerate:
		return "generación"
	case jobs.KindAnalyse:
		return "análisis"
	case jobs.KindReanalyse:
		return "re-lectura"
	case jobs.KindAnnotate:
		return "anotado"
	default:
		return string(k)
	}
}

// humanElapsed renders a duration as "hace N s" / "hace N min" / "hace
// N h" — the coarse buckets are enough for a banner that a professor
// refreshes every few seconds.
func humanElapsed(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("hace %d s", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("hace %d min", int(d.Minutes()))
	}
	return fmt.Sprintf("hace %d h", int(d.Hours()))
}

// JobDismissPath is POST target for the "Refrescar / Reintentar" button
// on the banner (issue #249). The id lives in the URL segment; the
// handler stamps viewed_at and redirects back to the control.
const JobDismissPath = "/jobs/{id}/dismiss"

// DismissJob stamps viewed_at on a job and redirects back to its
// control. Idempotent — dismissing a running job is fine too (the
// banner just hides on the next request; the runner keeps working).
func (h *Controls) DismissJob(w http.ResponseWriter, r *http.Request) {
	rawID := r.PathValue("id")
	jobID, err := strconv.ParseInt(rawID, 10, 64)
	if err != nil || jobID <= 0 {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese trabajo no existe.")
		return
	}
	job, err := h.Jobs.ByID(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, jobs.ErrJobNotFound) {
			middleware.WriteError(w, r, http.StatusNotFound, "Ese trabajo no existe.")
			return
		}
		h.Log.Error("dismiss job: fetch", "id", jobID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	if err := h.Jobs.MarkDismissed(r.Context(), jobID, time.Now()); err != nil {
		h.Log.Error("dismiss job: mark", "id", jobID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"No se pudo cerrar el aviso.")
		return
	}
	http.Redirect(w, r, controlDetailURL(job.ControlID), http.StatusSeeOther)
}

func jobDismissURL(id int64) string {
	return "/jobs/" + strconv.FormatInt(id, 10) + "/dismiss"
}

// isValidControlID enforces the ID's shape at the URL boundary so a stray
// path segment does not reach the store.
func isValidControlID(id string) bool {
	if len(id) != controls.IDLength {
		return false
	}
	for _, r := range id {
		if !(r >= 'A' && r <= 'Z') && !(r >= '2' && r <= '7') {
			return false
		}
	}
	return true
}

// controlDetailURL is the canonical URL of one control's detail page.
func controlDetailURL(id string) string {
	return ControlsPath + "/" + id
}

func controlSujetURL(id string) string {
	return controlDetailURL(id) + "/sujet.pdf"
}

// controlUploadURL is one uploaded batch's download URL (issue #204).
func controlUploadURL(id, batch string) string {
	return ControlsPath + "/" + id + "/uploads/" + batch
}

func controlCorrigeURL(id string) string {
	return controlDetailURL(id) + "/corrige.pdf"
}

func controlPoolJSONURL(id string) string {
	return controlDetailURL(id) + "/pool.json"
}

func controlScansURL(id string) string {
	return controlDetailURL(id) + "/scans"
}

func controlReanalyzeURL(id string) string {
	return controlDetailURL(id) + "/reanalyze"
}

func controlCloseURL(id string) string {
	return controlDetailURL(id) + "/close"
}

// closeGate implements the S8 rule: enabled when no reading holds an
// unresolved failure kind. Returns the reason otherwise, in Spanish, for
// the disabled button's hint. The rules mirror
// controls.Service.CloseCorrection so the disabled UI and the server-side
// guard agree.
func closeGate(c controls.Control, readings []controls.Reading) (bool, string) {
	if c.State == controls.Graded {
		return false, ""
	}
	blocking := 0
	for _, r := range readings {
		if r.CopyStatus == controls.CopyStatusNotPresent {
			continue
		}
		if r.CopyStatus == controls.CopyStatusIncomplete {
			blocking++
			continue
		}
		if r.RUTStatus == controls.RUTStatusUnreadable && r.RUTOverride == nil {
			blocking++
		}
		for _, a := range r.Answers {
			st := effectiveAnswerStatus(a)
			if st == controls.AnswerStatusDoubtful || st == controls.AnswerStatusAmbiguous {
				blocking++
				break
			}
		}
	}
	if blocking == 0 {
		return true, ""
	}
	return false, fmt.Sprintf("Faltan %d revisiones antes de cerrar.", blocking)
}

// perQuestionColumns returns the "P1, P2, …" header labels for the results
// table, one per question the control drew.
func perQuestionColumns(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("P%d", i+1)
	}
	return out
}

// toReadingRows turns each Reading into the pre-formatted table row.
// Grade math and the estado collapse live here so the template does no
// arithmetic.
func toReadingRows(c controls.Control, readings []controls.Reading) []view.ReadingRow {
	out := make([]view.ReadingRow, 0, len(readings))
	for _, r := range readings {
		out = append(out, toReadingRow(c, r))
	}
	return out
}

func toReadingRow(c controls.Control, r controls.Reading) view.ReadingRow {
	row := view.ReadingRow{
		CopyNumber:  r.CopyNumber,
		PerQuestion: renderPerQuestion(c.QuestionsPerCopy, r),
		ReviewURL:   controlReviewURL(c.ID, r.CopyNumber),
	}
	row.RUT, row.Edited = renderRUT(r)
	row.Estado, row.EstadoClass = estadoFor(r)
	row.TotalRaw, row.Grade = controls.TotalAndGrade(c.QuestionsPerCopy, r)
	return row
}

// controlReviewURL is the URL of one copy's review page (S5).
func controlReviewURL(controlID string, copyNumber int) string {
	return fmt.Sprintf("%s/copies/%d/review", controlDetailURL(controlID), copyNumber)
}

func renderRUT(r controls.Reading) (string, bool) {
	if r.RUTOverride != nil {
		return r.RUTOverride.RUT, true
	}
	if r.RUTStatus == controls.RUTStatusOK && r.RUTRead != nil {
		return *r.RUTRead, false
	}
	// Unreadable / not_present with no override.
	return "", false
}

// renderPerQuestion aligns answers to the P1..PN columns. Missing entries
// become "—" and doubtful/blank/ambiguous become "⚠".
func renderPerQuestion(cols int, r controls.Reading) []string {
	out := make([]string, cols)
	for i := range out {
		out[i] = "—"
	}
	if r.CopyStatus == controls.CopyStatusNotPresent {
		return out
	}
	// Answers are per-copy and their count equals the drawn questions;
	// alignment is by index, one to one. A row-level "editado" marker
	// beside the RUT is what surfaces overrides; per-question cells
	// display the same shape whether AMC or a human wrote them.
	for i, a := range r.Answers {
		if i >= cols {
			break
		}
		status := a.Status
		if a.Override != nil {
			status = a.Override.Status
		}
		out[i] = renderAnswerCell(status, a.Score, a.Max, a.QuestionType == controls.QuestionMultiple)
	}
	return out
}

func renderAnswerCell(status controls.AnswerStatus, score, max float64, multiple bool) string {
	if status == controls.AnswerStatusBlank ||
		status == controls.AnswerStatusAmbiguous ||
		status == controls.AnswerStatusDoubtful {
		return "⚠"
	}
	if max <= 0 {
		return "—"
	}
	rel := score / max
	if multiple {
		return fmt.Sprintf("%.2f", rel)
	}
	if rel == 1 {
		return "1"
	}
	if rel == 0 {
		return "0"
	}
	return fmt.Sprintf("%.2f", rel)
}

func estadoFor(r controls.Reading) (string, string) {
	switch r.CopyStatus {
	case controls.CopyStatusNotPresent:
		return "no rendida", "estado-no-rendida"
	case controls.CopyStatusIncomplete:
		return "⚠ página faltante", "estado-incompleta"
	}
	if r.RUTStatus == controls.RUTStatusUnreadable && r.RUTOverride == nil {
		return "⚠ RUT ilegible", "estado-rut"
	}
	for _, a := range r.Answers {
		effective := effectiveAnswerStatus(a)
		if effective == controls.AnswerStatusDoubtful ||
			effective == controls.AnswerStatusAmbiguous ||
			effective == controls.AnswerStatusBlank {
			return "⚠ marca dudosa", "estado-dudosa"
		}
	}
	return "ok", "estado-ok"
}

// effectiveAnswerStatus is the status the professor's decision (if any)
// left the answer at.
func effectiveAnswerStatus(a controls.Answer) controls.AnswerStatus {
	if a.Override != nil {
		return a.Override.Status
	}
	return a.Status
}

// summarise counts each collapse bucket for the results-table footer.
func summarise(readings []controls.Reading) string {
	if len(readings) == 0 {
		return ""
	}
	printed := len(readings)
	corregidas := 0
	revisar := 0
	noRendidas := 0
	for _, r := range readings {
		if r.CopyStatus == controls.CopyStatusNotPresent {
			noRendidas++
			continue
		}
		estado, _ := estadoFor(r)
		switch estado {
		case "ok":
			corregidas++
		default:
			revisar++
		}
	}
	return fmt.Sprintf("%d copias impresas · %d corregidas · %d requieren revisión · %d no rendidas",
		printed, corregidas, revisar, noRendidas)
}

// toListedControls turns domain values into rows the template can render
// without formatting. Same reasoning as toListedProfessors.
func (h *Controls) toListedControls(rows []controls.Control) []view.ListedControl {
	out := make([]view.ListedControl, 0, len(rows))
	for _, c := range rows {
		out = append(out, view.ListedControl{
			ID:              c.ID,
			Name:            c.Name,
			ApplicationDate: formatOptionalDate(c.ApplicationDate),
			Range:           formatRangeWithTitles(c.RangeFrom, c.RangeTo, h.Bank.Get()),
			Shape:           fmt.Sprintf("%d preguntas × %d copias", c.QuestionsPerCopy, c.Copies),
			State:           stateWordControl(c.State),
			DetailURL:       controlDetailURL(c.ID),
		})
	}
	return out
}

func toDetailedControl(c controls.Control, b *bank.Bank) view.DetailedControl {
	return view.DetailedControl{
		ID:              c.ID,
		Name:            c.Name,
		ApplicationDate: formatOptionalDate(c.ApplicationDate),
		Range:           formatRangeWithTitles(c.RangeFrom, c.RangeTo, b),
		Shape:           fmt.Sprintf("%d preguntas × %d copias", c.QuestionsPerCopy, c.Copies),
		PrintLayout:     printLayoutWord(c.DuplexPadding),
		Paper:           paperWord(c.Paper),
		State:           stateWordControl(c.State),
		CreatedAt:       spanishDate(c.CreatedAt),
	}
}

// printLayoutWord names the two layout modes for the detail page, so the
// professor sees which one their PDF carries. Issue #185, ADR-0039.
func printLayoutWord(duplexPadding bool) string {
	if duplexPadding {
		return "dúplex (con página en blanco por copia)"
	}
	return "simplex (una página por copia)"
}

// paperWord names the two paper sizes for the detail page. Issue #208,
// ADR-0043. An empty value (a control from before the migration ran) reads
// as the default, so the professor never sees a blank cell.
func paperWord(p controls.Paper) string {
	switch p {
	case controls.PaperA4:
		return "A4"
	default:
		return "US Letter"
	}
}

func formatOptionalDate(t *time.Time) string {
	if t == nil {
		return "Sin fecha"
	}
	return spanishDate(*t)
}

func formatRangeWithTitles(from, to bank.SectionRef, b *bank.Bank) string {
	fromDoc, fromOk := b.FindDocument(from.Document)
	toDoc, toOk := b.FindDocument(to.Document)
	fromTitle := from.Document
	toTitle := to.Document
	if fromOk {
		fromTitle = fromDoc.Title
	}
	if toOk {
		toTitle = toDoc.Title
	}
	return fmt.Sprintf("%s / %s → %s / %s", fromTitle, from.Section, toTitle, to.Section)
}

func stateWordControl(s controls.State) string {
	switch s {
	case controls.Generated:
		return "Generado"
	case controls.InReview:
		return "En revisión"
	case controls.Graded:
		return "Corregido"
	default:
		return string(s)
	}
}

// Root redirects `/` to `/controls`. Supersedes #151's redirect to
// `/professors` (issue #166 §The screens: with WP-E landed, controls are
// the professor's primary activity).
func (h *Controls) Root(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, ControlsPath, http.StatusSeeOther)
}
