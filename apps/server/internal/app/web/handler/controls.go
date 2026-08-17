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
// every other route in this surface (issue #151 §Routes).
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
type Controls struct {
	Service   *controls.Service
	Store     controls.Store
	Bank      *bank.Bank
	PublicURL string
	Log       *slog.Logger

	secureCookie bool
}

// NewControls returns the handlers.
func NewControls(deps Controls) *Controls {
	switch {
	case deps.Service == nil:
		panic("handler.NewControls: no service")
	case deps.Store == nil:
		panic("handler.NewControls: no store")
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

// List renders every control the store returns, ordered as the store
// promises (application_date desc, nulls last).
func (h *Controls) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Store.ListControls(r.Context())
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
	page := h.newFormPage(r, defaultFormValues(), nil, "", "")
	if err := view.RenderControlsForm(w, http.StatusOK, page); err != nil {
		h.Log.Error("rendering the controls create form", "error", err)
	}
}

// Create validates the form, orchestrates via the Service, flashes and
// redirects on success or re-renders with per-field errors on refusal.
func (h *Controls) Create(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		h.rerenderNew(w, r, defaultFormValues(), nil,
			"No se pudo leer el formulario. Inténtalo de nuevo.", "")
		return
	}

	values := valuesFromRequest(r)
	errs, req, appDateErr := validateCreate(values, h.Bank)
	if appDateErr != "" {
		if errs == nil {
			errs = map[string]string{}
		}
		errs["application_date"] = appDateErr
	}
	if len(errs) > 0 {
		h.rerenderNew(w, r, values, errs, "", "")
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
		fieldErr, message, ok := domainErrorToForm(err)
		if !ok {
			// A failure the professor cannot repair — worker down, sujet
			// missing, disk full. Log it, render a 500 through the shell
			// (§Failure modes: "Renders the shell's 500 page…").
			h.Log.Error("creating a control", "error", err, "professor", acting.ID)
			middleware.WriteError(w, r, http.StatusInternalServerError,
				"El servidor no pudo generar el control. Vuelve a intentarlo en unos minutos; si el problema persiste, avisa a alguien de infraestructura.")
			return
		}
		h.rerenderNew(w, r, values, fieldErr, message, "")
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
	c, err := h.Store.ControlByID(r.Context(), id)
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
		Page:       middleware.PageFor(r, c.Name),
		Control:    toDetailedControl(c, h.Bank),
		SujetURL:   controlSujetURL(c.ID),
		CorrigeURL: controlCorrigeURL(c.ID),
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
	if _, err := h.Store.ControlByID(r.Context(), id); err != nil {
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
func (h *Controls) rerenderNew(w http.ResponseWriter, r *http.Request, values view.ControlFormValues, errs map[string]string, notice, poolPreview string) {
	page := h.newFormPage(r, values, errs, notice, poolPreview)
	if err := view.RenderControlsForm(w, http.StatusUnprocessableEntity, page); err != nil {
		h.Log.Error("rendering the controls form after validation", "error", err)
	}
}

func (h *Controls) newFormPage(r *http.Request, values view.ControlFormValues, errs map[string]string, notice, poolPreview string) view.ControlsFormPage {
	return view.ControlsFormPage{
		Page:           middleware.PageFor(r, "Nuevo control"),
		Action:         ControlsPath,
		Submit:         "Generar control",
		Heading:        "Nuevo control",
		Values:         values,
		Errors:         errs,
		Notice:         notice,
		SectionOptions: sectionOptionsFromBank(h.Bank, values),
		PoolPreview:    poolPreview,
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
// empty means valid. Also returns the parsed CreateRequest (populated only
// when the map is empty) and any application_date error to be re-inserted
// after the map is built (a parse error is per-field but application_date
// is optional; the empty case is valid and the presence of an error only
// matters when a value was typed).
func validateCreate(v view.ControlFormValues, b *bank.Bank) (map[string]string, controls.CreateRequest, string) {
	errs := map[string]string{}

	if v.Name == "" {
		errs["name"] = "El nombre es obligatorio."
	} else if len([]rune(v.Name)) < minNameLength {
		errs["name"] = "El nombre debe tener al menos 3 caracteres."
	} else if len([]rune(v.Name)) > maxNameLength {
		errs["name"] = "El nombre debe tener a lo más 100 caracteres."
	}

	var appDate *time.Time
	var appDateErr string
	if v.ApplicationDate != "" {
		parsed, err := time.Parse("2006-01-02", v.ApplicationDate)
		if err != nil {
			appDateErr = "La fecha no tiene la forma esperada (AAAA-MM-DD)."
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
	return errs, req, appDateErr
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
// notice, ok). ok is false for errors the professor cannot repair; those
// bubble up as a 500 in Create.
func domainErrorToForm(err error) (map[string]string, string, bool) {
	switch {
	case errors.Is(err, bank.ErrRangeInverted):
		return map[string]string{"to": "El fin va antes que el inicio en el orden de lectura."}, "", true
	case errors.Is(err, bank.ErrEmptyRange):
		return map[string]string{"to": "El rango no tiene preguntas todavía."}, "", true
	case errors.Is(err, bank.ErrUnknownDocument), errors.Is(err, bank.ErrUnknownSection):
		return map[string]string{"from": "Ese rango no existe en el banco."}, "", true
	case errors.Is(err, controls.ErrPoolTooSmall):
		var pool controls.PoolTooSmallErr
		if errors.As(err, &pool) {
			return map[string]string{
				"questions_per_copy": fmt.Sprintf(
					"Pediste %d preguntas por copia, pero el rango solo tiene %d disponibles.",
					pool.QuestionsPerCopy, pool.Pool),
			}, "", true
		}
	}
	return nil, "", false
}

// sectionOptionsFromBank builds the range dropdowns from the bank, in
// reading order. A pre-selected value (from a form re-render) sets
// IsSelected — actually done inline in the template with a comparison
// against the composite value, so no per-option flag is needed here.
func sectionOptionsFromBank(b *bank.Bank, _ view.ControlFormValues) []view.DocumentSections {
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
