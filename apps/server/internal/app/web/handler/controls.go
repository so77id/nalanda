package handler

import (
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
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The controls routes (issue #166 §The screens). URL paths in English like
// every other route in this surface (issue #151 §Routes). WP-F extends the
// set with the scan-upload target (ControlScansPath in scans.go).
const (
	ControlsPath       = "/controls"
	ControlsNewPath    = "/controls/new"
	ControlDetailPath  = "/controls/{id}"
	ControlSujetPath   = "/controls/{id}/sujet.pdf"
	ControlCorrigePath = "/controls/{id}/corrige.pdf"
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
	Service   *controls.Service
	Bank      *bank.Bank
	PublicURL string
	// MaxScanBytes is the largest scan upload the handler accepts. Comes
	// from config.MaxScanBytes so main is the only place the byte value
	// is composed (backend-code-style.md §Configuration).
	MaxScanBytes int64
	Log          *slog.Logger

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
	errs, req := validateCreate(values, h.Bank)
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

	control, err := h.Service.Create(r.Context(), req)
	if err != nil {
		fieldErr, ok := domainErrorToForm(err)
		if !ok {
			// A failure the professor cannot repair — worker down, sujet
			// missing, disk full. Log it, render a 500 through the shell
			// (§Failure modes: "Renders the shell's 500 page…").
			h.Log.Error("creating a control", "error", err, "professor", acting.ID)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El servidor no pudo generar el control. Vuelve a intentarlo en unos minutos; si el problema persiste, avisa a alguien de infraestructura.")
			return
		}
		h.rerenderNew(w, r, values, fieldErr, "")
		return
	}

	flash.Set(w, h.secureCookie, "Control «"+control.Name+"» generado.")
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

	page := view.ControlDetailPage{
		Page:          middleware.PageFor(r, c.Name),
		Control:       toDetailedControl(c, h.Bank),
		SujetURL:      controlSujetURL(c.ID),
		CorrigeURL:    controlCorrigeURL(c.ID),
		ScansURL:      controlScansURL(c.ID),
		ReanalyzeURL:  controlReanalyzeURL(c.ID),
		CloseURL:      controlCloseURL(c.ID),
		MaxScanMB:     h.MaxScanBytes >> 20,
		CurrentTicked: defaultTicked,
		CurrentUnsure: defaultUnsure,
		Graded:        c.State == controls.Graded,
	}
	if h.Service != nil {
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
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)

	if err := view.RenderControlDetail(w, page); err != nil {
		h.Log.Error("rendering the control detail", "error", err)
	}
}

// SujetPDF and CorrigePDF stream the PDF files from the shared volume.
// Wrote-through helpers so a caller cannot accidentally hand back
// something outside the control's own directory.
func (h *Controls) SujetPDF(w http.ResponseWriter, r *http.Request) {
	h.servePDF(w, r, "sujet.pdf")
}

func (h *Controls) CorrigePDF(w http.ResponseWriter, r *http.Request) {
	h.servePDF(w, r, "corrige.pdf")
}

func (h *Controls) servePDF(w http.ResponseWriter, r *http.Request, name string) {
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
		h.Log.Error("reading a control for PDF", "error", err, "id", id)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}

	var path string
	switch name {
	case "sujet.pdf":
		path = h.Service.SujetPath(id)
	case "corrige.pdf":
		path = h.Service.CorrigePath(id)
	default:
		middleware.WriteError(w, r, http.StatusNotFound, "Descarga no disponible.")
		return
	}

	f, err := os.Open(path)
	if err != nil {
		h.Log.Warn("serving control PDF", "id", id, "name", name, "error", err)
		middleware.WriteError(w, r, http.StatusNotFound,
			"El PDF del control no está disponible. Puede que se haya limpiado del volumen compartido.")
		return
	}
	defer func() { _ = f.Close() }()

	info, err := f.Stat()
	if err != nil {
		h.Log.Error("stat control PDF", "id", id, "name", name, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError,
			"Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos.")
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="control-%s-%s"`, id, name))
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
		SectionOptions: sectionOptionsFromBank(h.Bank),
	}
}

// defaultFormValues returns the values the empty GET form starts from.
func defaultFormValues() view.ControlFormValues {
	return view.ControlFormValues{
		QuestionsPerCopy: strconv.Itoa(defaultQuestionsPerCopy),
		Copies:           strconv.Itoa(defaultCopies),
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

	req := controls.CreateRequest{
		Name:             v.Name,
		ApplicationDate:  appDate,
		RangeFrom:        from,
		RangeTo:          to,
		QuestionsPerCopy: qpc,
		Copies:           copies,
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

func controlCorrigeURL(id string) string {
	return controlDetailURL(id) + "/corrige.pdf"
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
// the disabled button's hint.
func closeGate(c controls.Control, readings []controls.Reading) (bool, string) {
	if c.State == controls.Graded {
		return false, ""
	}
	blockingIncomplete := 0
	blockingRUT := 0
	blockingDoubtful := 0
	for _, r := range readings {
		if r.CopyStatus == controls.CopyStatusNotPresent {
			continue
		}
		if r.CopyStatus == controls.CopyStatusIncomplete {
			blockingIncomplete++
			continue
		}
		if r.RUTStatus == controls.RUTStatusUnreadable && r.RUTOverride == nil {
			blockingRUT++
		}
		for _, a := range r.Answers {
			st := effectiveAnswerStatus(a)
			if st == controls.AnswerStatusDoubtful || st == controls.AnswerStatusAmbiguous {
				if a.Override == nil {
					blockingDoubtful++
					break
				}
			}
		}
	}
	total := blockingIncomplete + blockingRUT + blockingDoubtful
	if total == 0 {
		return true, ""
	}
	return false, fmt.Sprintf("Faltan %d revisiones antes de cerrar.", total)
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
	row.TotalRaw, row.Grade = totalAndGrade(c.QuestionsPerCopy, r)
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
	return "", r.RUTOverride != nil
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
	// alignment is by index, one to one.
	for i, a := range r.Answers {
		if i >= cols {
			break
		}
		if a.Override != nil {
			out[i] = renderAnswerCell(a.Override.Status, a.Score, a.Max, true, a.QuestionType == controls.QuestionMultiple)
			continue
		}
		out[i] = renderAnswerCell(a.Status, a.Score, a.Max, false, a.QuestionType == controls.QuestionMultiple)
	}
	return out
}

func renderAnswerCell(status controls.AnswerStatus, score, max float64, edited, multiple bool) string {
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

// totalAndGrade computes "Σ relative / N" over the drawn questions, plus
// the 1,0–7,0 mark (§C7: 4,0 at 50%, linear either side). Returns raw
// like "3.50/4" and grade like "5.5", or "—/—" for a not_present copy.
func totalAndGrade(questions int, r controls.Reading) (string, string) {
	if r.CopyStatus == controls.CopyStatusNotPresent {
		return "—", "—"
	}
	// Any unresolved failure leaves the total unknown until the review
	// is done — the estado column carries the reason.
	if r.RUTStatus == controls.RUTStatusUnreadable && r.RUTOverride == nil {
		return "—", "—"
	}
	total := 0.0
	for _, a := range r.Answers {
		effective := effectiveAnswerStatus(a)
		if effective == controls.AnswerStatusDoubtful || effective == controls.AnswerStatusAmbiguous {
			return "—", "—"
		}
		if effective == controls.AnswerStatusBlank {
			continue
		}
		if a.Override != nil {
			// Overrides do not carry per-question scores; a corrected
			// answer earns the whole point (§AC-4 override contract).
			total += 1.0
			continue
		}
		if a.Max > 0 {
			total += a.Score / a.Max
		}
	}
	if questions == 0 {
		return "—", "—"
	}
	return fmt.Sprintf("%.2f/%d", total, questions), formatGrade(total, questions)
}

// formatGrade maps a fraction onto the 1,0–7,0 scale: 4,0 at 50%, linear
// on either side (§C7). Rounded to one decimal.
func formatGrade(total float64, questions int) string {
	if questions == 0 {
		return "—"
	}
	pct := total / float64(questions)
	grade := 1.0
	if pct <= 0 {
		grade = 1.0
	} else if pct <= 0.5 {
		grade = 1.0 + 6.0*pct // 0.0→1.0, 0.5→4.0
	} else if pct >= 1.0 {
		grade = 7.0
	} else {
		grade = 4.0 + 6.0*(pct-0.5) // 0.5→4.0, 1.0→7.0
	}
	return fmt.Sprintf("%.1f", grade)
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
		switch r.CopyStatus {
		case controls.CopyStatusNotPresent:
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
			Range:           formatRangeWithTitles(c.RangeFrom, c.RangeTo, h.Bank),
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
		State:           stateWordControl(c.State),
		CreatedAt:       spanishDate(c.CreatedAt),
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
