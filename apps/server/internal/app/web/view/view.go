// Package view renders the backoffice's HTML.
//
// The shell born with WP-C3 (#151, S1). Every page renders through the layout
// in templates/layout.html — nav, both themes, embedded CSS — so a new page
// arrives with the shape the rest of the surface has, and cannot ship bare.
//
// The templates are parsed ONCE at package initialisation and embedded in the
// binary. Parsing per request would turn a typo in a template into a 500 that
// only appears on the page nobody visits; parsing at start turns it into a
// panic at boot, which is a failure an operator sees immediately and a test can
// reproduce. This is the one place a panic is right (backend-code-style.md
// §Errors: never in a request path, fine at wiring time).
//
// One *template.Template per page rather than one template set for all of them.
// Each page defines the `content` block the layout invokes; parsing every page
// into one set would leave the last-defined `content` visible to everything
// else — the shell would silently render whichever page happened to be parsed
// last on top of the layout. A clone per page is what keeps the pages
// independent.
package view

import (
	"bytes"
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls/stats"
)

//go:embed templates/layout.html templates/pages/*.html
var files embed.FS

var pages = mustParsePages()

// Page is the layout's contract. Every page struct embeds it so the shell can
// render the title and, when there is one, the professor's bar without knowing
// what specific data the page carries.
type Page struct {
	// Title goes into the <title>; " · Nalanda" is appended by the layout so
	// no page has to remember to.
	Title string
	// Professor is nil for an anonymous visitor. The layout hides the bar in
	// that case and centers the content, which is what makes the login page
	// look the same as it did before this shell existed.
	Professor *auth.User
	// CSRFToken goes into the logout form in the bar. Empty when Professor is
	// nil, because there is no form.
	CSRFToken string
	// Flash is the one-shot message the flash package consumed on this GET,
	// if any. Rendered by the layout above the page's content, once, so a
	// mutation that redirects can say what happened without putting the
	// message in the URL (issue #151 §Flash).
	Flash string
}

// ProfessorsFormPage is what professors_new.html and (in S7)
// professors_edit.html render. It holds the values a submission carried and
// the errors validation produced — the WP's form / validation / error
// convention (issue #151 §Goals):
//
//   - the SAME page renders empty (GET), pre-filled (validation failure
//     re-render), and, when reusing this shape, with a pre-existing row
//     (S7's edit form);
//   - errors are field-keyed rather than a single blob, so the template can
//     mark each field with the message it broke on;
//   - the values the professor typed come back so they do not retype them.
//
// A form that lost the invalid input on refusal would tell a professor with a
// mistyped comma to type the whole thing again — a bad UX and a subtle
// invitation to type it differently the second time and hit a different
// validation branch.
type ProfessorsFormPage struct {
	Page
	Action  string
	Values  ProfessorFormValues
	Errors  map[string]string
	Submit  string
	Heading string
	// EmailReadonly is set by S7's edit form: the address is deliberately
	// not editable (issue #151 §Non-goals). The create form leaves it false.
	EmailReadonly bool
	// Notice is a non-field message rendered above the fields — used for
	// form-wide failures like "could not read the form" that do not belong
	// to any single field. Errors[""] was tried first and silently dropped
	// by the template (COR-1, WP review), which is why the slot has its own
	// name now.
	Notice string
}

// ProfessorFormValues holds what the user typed. Rendered back into the
// inputs on a validation-failure re-render.
type ProfessorFormValues struct {
	Email string
	Name  string
}

// ProfilePage is what profile.html renders: the professor's own account and
// the state of their Canvas integration.
//
// Three states, and the template branches on them in this order, because
// they are not independent:
//
//  1. !SecretsConfigured — the deployment has no master key, so there is
//     nothing to show a form for (ADR-0068 §Decision 3).
//  2. Connected — a token is stored. The form becomes "replace", and a
//     second form offers to forget it.
//  3. neither — the empty state, with the instructions for generating a
//     token in Canvas.
//
// There is deliberately NO field carrying the token. The page cannot render
// it back even by accident: the value is not in this struct, and the input's
// `value` is the empty string in every branch (issue #271 AC-6).
type ProfilePage struct {
	Page
	Email string
	Name  string

	// SecretsConfigured is canvas.Service.Configured() — whether the
	// deployment can store a secret at all.
	SecretsConfigured bool
	// Connected is whether THIS professor has a token stored.
	Connected bool

	// Action is where the save/replace form posts; ForgetAction is where
	// the delete form posts. Passed in rather than written in the template
	// so the route constants have one home.
	Action       string
	ForgetAction string

	// Errors is field-keyed like every other form on this surface — a
	// single blob would make a two-error submission read as "something
	// went wrong" (§Form / validation / errors).
	Errors map[string]string
}

// ProfessorsListPage is what professors_list.html renders. The row values
// are pre-formatted by the handler; see handler/professors.go for why.
type ProfessorsListPage struct {
	Page
	Professors []ListedProfessor
	// SelfID is the id of the professor viewing the page. The template uses
	// it to hide the "Desactivar" button on the row that IS them — the
	// domain would refuse the action (auth.ErrCannotDeactivateSelf) but the
	// button that leads there might as well not be shown.
	SelfID int64
}

// ListedProfessor is one row of the CRUD's list, with every column already
// as a string a person reads. Not the domain's auth.User: dates are a
// formatted Spanish short date and state is a Spanish word, so the template
// carries no formatting logic and cannot get it wrong.
type ListedProfessor struct {
	ID         int64
	Email      string
	Name       string
	IsActive   bool
	State      string
	CreatedAt  string
	LastSignIn string
}

// ControlsListPage is what controls_list.html renders (S7). One row per
// control, with the columns issue #166 §The screens asks for. All values
// are pre-formatted by the handler (Spanish dates, human ranges), same
// reasoning as ProfessorsListPage.
type ControlsListPage struct {
	Page
	Controls []ListedControl
}

// ListedControl is one row of the controls list, with every column already
// as a string a person reads.
type ListedControl struct {
	ID              string
	Name            string
	ApplicationDate string // "sin fecha" for a control with no date
	Range           string // "Bienvenida/hola → Flujo/bucles"
	Shape           string // "4 preguntas × 30 copias"
	State           string // Spanish word matching the domain State
	DetailURL       string
}

// ControlsArchivedPage is what controls_archived.html renders (issue #261).
// One row per archived control, deleted_at DESC. Each row carries the
// Restore POST target and the Purge-confirm GET target — the destructive
// step deliberately does not fit inline.
type ControlsArchivedPage struct {
	Page
	Controls []ArchivedControl
}

// ControlPurgeConfirmPage is the confirmation screen for a hard delete
// (issue #261). Renders "Eliminar {Name} permanentemente" and a form
// that only submits when the professor typed the exact name into the
// confirm_name field. The handler re-validates server-side.
type ControlPurgeConfirmPage struct {
	Page
	Control  ArchivedControl
	PurgeURL string
	// NameMismatch renders below the input on a re-render after the
	// professor typed the wrong name. Empty on the first GET.
	NameMismatch string
	// Typed carries the previous value of the confirm_name input so the
	// form does not silently blank on refusal (the pattern the create
	// form uses on validation refusal). Empty on the first GET.
	Typed string
}

// ArchivedControl is one row of the archived listing. Same pre-formatted
// shape as ListedControl plus the archived-at column and the two URLs the
// two operations target.
type ArchivedControl struct {
	ID              string
	Name            string
	ApplicationDate string
	Range           string
	Shape           string
	State           string
	ArchivedAt      string // "26 de agosto, 2026"
	DetailURL       string
	RestoreURL      string
	PurgeConfirmURL string
}

// ControlsFormPage is what controls_form.html renders. Same one-template-
// for-three-purposes shape as ProfessorsFormPage (issue #151 §Form /
// validation / errors): GET (empty), validation-failure re-render (values
// + errors), and — when a future WP grows an edit form — pre-filled.
type ControlsFormPage struct {
	Page
	Action  string
	Values  ControlFormValues
	Errors  map[string]string
	Notice  string
	Submit  string
	Heading string
	// SectionOptions lists every (document, section) pair the bank
	// publishes, in reading order, so the two range dropdowns can render
	// them. Grouped by document so an <optgroup> renders per document.
	SectionOptions []DocumentSections
}

// ControlFormValues holds what the user typed. Values are echoed back on
// refusal (§Form: "The values the professor typed come back on refusal").
type ControlFormValues struct {
	Name             string
	ApplicationDate  string // "YYYY-MM-DD" or empty
	FromDocument     string
	FromSection      string
	ToDocument       string
	ToSection        string
	QuestionsPerCopy string
	Copies           string
	// DuplexPadding echoes the checkbox state so the template can render
	// `checked` after a refusal that preserves the professor's choice.
	// Default true at the empty-GET form step (defaultFormValues), which
	// keeps the historical layout without the professor having to think
	// about it. Issue #185.
	DuplexPadding bool
	// Paper echoes the radio the professor picked, so the template can
	// re-render `checked` after a refusal. Two legal string values:
	// "letter" (default) and "a4"; lives inside `<details> Opciones
	// avanzadas` so the default requires no interaction. Issue #208,
	// ADR-0043.
	Paper string
}

// DocumentSections carries one document's sections for the range
// dropdowns. Title is what the professor reads; Sections carry both slugs
// and the section text ('hola' → 'hola'; the bank does not carry a
// separate title per section today).
type DocumentSections struct {
	DocumentID    string
	DocumentTitle string
	Sections      []SectionOption
}

// SectionOption is one option in the range dropdown. Value is
// "document:section", the string a form submission sends. The template
// decides which option is selected by comparing Value against the
// composite form value (Values.FromDocument + ":" + Values.FromSection).
type SectionOption struct {
	Value   string
	Label   string
	Section string
}

// ControlDetailPage is what controls_detail.html renders. It grows with
// each WP: WP-E landed the three boxes (§The screens); WP-F fills the
// Escaneos box with an upload form and appends a Resultados table when
// readings exist.
type ControlDetailPage struct {
	Page
	Control    DetailedControl
	SujetURL   string
	CorrigeURL string
	// PoolJSONURL is the download of the pool snapshot written at Create
	// time (issue #198).
	PoolJSONURL string
	// ScansURL is the POST target of the upload form.
	ScansURL string
	// MaxScanMB is what the Spanish "máximo N MB" hint says on the
	// form. The unit is megabytes — the handler enforces the byte
	// value.
	MaxScanMB int64
	// Readings is the list of copies known so far (empty for a control
	// with no uploads). WP-F S4 renders the results table off this.
	Readings []ReadingRow
	// Summary is the "N impresas · M corregidas · K requieren revisión · L no rendidas"
	// line under the table. Empty when Readings is empty.
	Summary string
	// QuestionColumns is the header row for the per-question columns
	// (P1, P2, …), sized to control.QuestionsPerCopy.
	QuestionColumns []string
	// ReanalyzeURL is the POST target for "re-leer con otra sensibilidad".
	ReanalyzeURL string
	// Uploads lists the uploaded scan batches with their download URLs
	// (issue #204). Empty while nothing was uploaded — the template then
	// renders no section at all.
	Uploads []UploadedBatch

	// CurrentTicked / CurrentUnsure pre-fill the reanalyze form with the
	// last thresholds used (or the defaults for a first read).
	CurrentTicked float64
	CurrentUnsure float64
	// CanClose is true when the state gate for "Cerrar corrección" is
	// satisfied. WP-F S8 populates it.
	CanClose bool
	// CloseBlockedReason is the Spanish sentence explaining what stops
	// the professor from closing yet, empty when CanClose is true.
	CloseBlockedReason string
	// CloseURL is the POST target for "Cerrar corrección".
	CloseURL string
	// Graded is true when control.state = graded — the template surfaces
	// the "correction was closed" line above the results table.
	Graded bool
	// Stats is the statistics panel's data (issue #251). Non-nil ONLY
	// when Graded is true AND at least one reading was graded (N ≥ 1 in
	// stats.Global). The template renders `<section id="estadisticas">`
	// when this is non-nil and nothing when it is nil, so a control
	// with State != Graded (or a Graded control with N = 0) shows no
	// panel at all rather than a "no hay datos" empty state.
	Stats *stats.Statistics

	// JobBanner, when non-nil, renders the async job runner's status
	// on the detail page: "Procesando re-lectura… (hace 15 s). Refrescá
	// la página cuando el aviso cambie." for a running job,
	// "re-lectura lista." for a done job, or "re-lectura falló: …" for
	// a failed one. Every branch shows a "Refrescar" (running / done)
	// or "Cerrar aviso" (failed) button that POSTs to
	// /jobs/{JobID}/dismiss. Nil hides the banner entirely (issue
	// #249). The runner drives the state — this struct only carries
	// what the template needs to render one iteration.
	JobBanner *JobBanner

	// PDFsReady gates the "Prueba a imprimir" section on the Detail
	// page: sujet.pdf, corrige.pdf and pool.json are only offered as
	// downloads when they can actually be served (issue #257). True
	// when the latest generate job for this control is `done` — or
	// when NO generate job row exists (pre-#249 rows, or rows created
	// directly via PrepareControl+GenerateAssets in tests). False
	// while the generate is queued/running/failed; the banner then
	// tells the professor why.
	PDFsReady bool

	// Archived is true when control.deleted_at IS NOT NULL (issue #261).
	// The template surfaces a banner at the top of the page ("Este
	// control está archivado…") with a Restore button, and hides the
	// danger zone (Archive would fail anyway). Every other section stays
	// visible so the professor can still consult the archived control's
	// data, but the operational forms (upload scans, close, reanalyse)
	// remain technically live — the banner is the fricción del profesor
	// and the WP intentionally does not duplicate the policy on the
	// server side (§Design > UI).
	Archived bool
	// ArchiveURL and RestoreURL are BOTH always populated; the template
	// picks one via {{ if .Archived }} / {{ if not .Archived }}. Handled
	// this way — rather than by leaving one empty per shape — so a
	// template change that renders both branches under a different
	// flag never dereferences a zero string (Round-A ARQ-2).
	ArchiveURL string
	RestoreURL string
}

// JobBanner is the summary of a control's most recent async job for the
// detail page (issue #249). Composed by the handler from the latest
// jobs.Job row — the template does no time arithmetic.
type JobBanner struct {
	JobID int64
	// Kind is the Spanish label ("re-lectura", "análisis", "generación",
	// "anotado") — the template renders it verbatim inside
	// "Procesando {Kind}…".
	Kind string
	// Running is true while the runner is still working on the job.
	// The template shows the "Procesando {Kind}…" line with StartedAgo.
	Running bool
	// Done is true when the job finished successfully AND has not yet
	// been dismissed. Failed = true is the failure branch.
	Done   bool
	Failed bool
	// StartedAgo is the human phrase for "hace 15 s" / "hace 2 min",
	// rendered while Running.
	StartedAgo string
	// Error is the AnalyzerRefusedError.Message (or another short
	// summary) the runner recorded. Only populated when Failed.
	Error string
	// DismissURL is POST /jobs/{id}/dismiss — the "Refrescar" (running /
	// done) and "Cerrar aviso" (failed) button both target it. The
	// professor re-submits the operation from the usual form after
	// dismissing.
	DismissURL string
}

// ReadingRow is one row of the results table. Everything is pre-formatted
// for the template so it does no arithmetic (issue #167 §The results
// table).
type ReadingRow struct {
	CopyNumber int
	// RUT is the eight digits to render, or empty when unreadable /
	// not-present.
	RUT string
	// PerQuestion is per-question cells (already formatted with the
	// relative or "⚠" or "—"), aligned to QuestionColumns.
	PerQuestion []string
	// TotalRaw is like "3.5/4" or "—".
	TotalRaw string
	// Grade is like "6.5" or "—".
	Grade string
	// Estado is the Spanish estado word / phrase per §The results
	// table's collapse rules.
	Estado string
	// EstadoClass is the CSS class the row applies for coloring.
	EstadoClass string
	// ReviewURL is the "[revisar]" link — always present, WP-F allows
	// review of any row.
	ReviewURL string
	// Edited is true when the row carries at least one override; the
	// template renders a subtle marker.
	Edited bool
}

// DetailedControl is the metadata the detail page shows, pre-formatted.
type DetailedControl struct {
	ID              string
	Name            string
	ApplicationDate string
	Range           string
	Shape           string
	// PrintLayout is the human phrase for control.duplex_padding: "dúplex
	// (con página en blanco)" or "simplex (una página por copia)". Shown
	// on the detail page so the professor sees the layout their generated
	// PDF actually carries (issue #185, ADR-0039).
	PrintLayout string
	// Paper is the human phrase for control.paper: "US Letter" or "A4".
	// Shown on the detail page so the professor can see which paper the
	// PDF assumes for a print (issue #208, ADR-0043).
	Paper     string
	State     string
	CreatedAt string
}

// UploadedBatch is one uploaded scan batch's download link (issue #204).
type UploadedBatch struct {
	Name string // the stored batch-N.pdf name (the original filename is not kept)
	URL  string
}

// ReviewPage is what review.html renders (WP-F §The screens). Split view:
// scanned image on the left, editable form on the right. Since issue #190
// the left side shows the corrected PDF when one exists (HasAnnotated) and
// the raw scan otherwise.
type ReviewPage struct {
	Page
	ControlID  string
	Name       string
	CopyNumber int
	BackURL    string
	// Pages is the raw-scan fallback's per-page images (issue #243):
	// one entry per physical page AMC captured, in ascending order.
	// The template iterates it and renders one <img> per page — a
	// two-page copy shows both pages stacked. Always populated for a
	// reviewable copy (migration 00011 backfills legacy rows to [1]
	// and amcworker.toDomain substitutes [1] for a legacy worker),
	// so the template's `{{ range .Pages }}` never sees an empty
	// list in practice; a not_present copy reached by hand-typed URL
	// is the one exception, and its empty list renders an empty
	// "Escaneo" section rather than a broken-image placeholder.
	// Consumed only when HasAnnotated is false; the PDF.js viewer
	// takes over otherwise.
	Pages   []ReviewImage
	SaveURL string
	Graded  bool // when true the template shows the "editing a closed correction" warning
	// HasAnnotated / AnnotatedURL carry the corrected PDF (issue #190).
	// AnnotatedURL is empty when HasAnnotated is false.
	HasAnnotated bool
	AnnotatedURL string
	RUT          ReviewRUT
	Questions    []ReviewQuestion
}

// ReviewImage is one page of a copy's raw scan (issue #243). The
// review page's raw-scan fallback iterates ReviewPage.Pages and
// emits one <img> per entry. Number is what AMC's capture_page
// reported; URL is the /copies/N/page/M endpoint.
type ReviewImage struct {
	Number int
	URL    string
}

// ReviewRUT is the top row of the form — the RUT block.
type ReviewRUT struct {
	Value        string
	OriginalRead string
	Status       string
	Overridden   bool
	WasRead      bool
}

// ReviewQuestion is one row of the review form.
type ReviewQuestion struct {
	Index        int
	QuestionRef  string
	Statement    string
	Type         string // "simple" | "multiple"
	Alternatives []ReviewAlternative
	Selected     []int
	Status       string
	Overridden   bool
	OriginalRead string // "AMC leyó: …" — empty when unedited
}

// ReviewAlternative is one option a professor can pick.
type ReviewAlternative struct {
	Index int
	Label string
}

// IsSelected is a helper the template calls — Go html/template's `in`
// operator does not exist, and a template-level map lookup on []int is
// awkward. One method per test keeps the template readable.
func (q ReviewQuestion) IsSelected(index int) bool {
	for _, s := range q.Selected {
		if s == index {
			return true
		}
	}
	return false
}

// ErrorPage is what error.html renders. AC-11: 404, 403 and 500 render
// through the shell rather than as Go's default text.
//
// Status is the numeric status shown to the reader — it is not what the
// RESPONSE carries, because the response status is a separate concern set by
// the caller through the writer. Keeping the two decoupled is what lets a
// caller shape one 500 as "the database is down" and another as "an internal
// error" without inventing a template per shape.
type ErrorPage struct {
	Page
	Status  int
	Message string
}

// templateFuncs is registered on every parsed template.
//
// splitLines turns a multi-line flash into a []string the layout can range
// over: a save review flash carries one line per action ("RUT actualizado
// a X", "Cambios en 3 respuestas") joined by "\n" — see
// handler.buildSaveReviewFlash (issue #228 S3).
var templateFuncs = template.FuncMap{
	"splitLines": func(s string) []string { return strings.Split(s, "\n") },
	// Stats-panel helpers (issue #251). All pure integer / float math —
	// arithmetic in the template beats a second pass in Go and keeps the
	// data plane free of layout arithmetic.
	"add":    func(a, b int) int { return a + b },
	"sub":    func(a, b int) int { return a - b },
	"mul":    func(a, b int) int { return a * b },
	"pctInt": func(part, total, span int) int { return part * span / total },
	// gradeX maps a 1.0–7.0 grade onto a 0–600 pixel band, so the
	// boxplot and the histogram share the same x-axis span.
	"gradeX": func(g float64) int { return int((g - 1.0) * 100) },
	// letter renders the A/B/C… label for a 0-indexed authoring
	// alternative. Only meaningful up to five (Nalanda's controls do
	// not exceed the alphabet in practice).
	"letter": func(i int) string { return string(rune('A' + i)) },
	// isCorrect reports whether the alternative index (0-based) is in
	// the bank's Correct set for that question.
	"isCorrect": func(i int, correct []int) bool {
		for _, c := range correct {
			if c == i {
				return true
			}
		}
		return false
	},
	// seven yields the axis-tick indices 0..6 (grade 1..7) — a helper
	// because html/template has no `range 7` shorthand.
	"seven": func() []int { return []int{0, 1, 2, 3, 4, 5, 6} },
}

func mustParsePages() map[string]*template.Template {
	layout, err := template.New("layout.html").Funcs(templateFuncs).ParseFS(files, "templates/layout.html")
	if err != nil {
		panic("view: parse layout: " + err.Error())
	}

	entries, err := fs.ReadDir(files, "templates/pages")
	if err != nil {
		panic("view: read pages: " + err.Error())
	}

	out := make(map[string]*template.Template, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".html") {
			continue
		}
		clone, err := layout.Clone()
		if err != nil {
			panic("view: clone layout for " + entry.Name() + ": " + err.Error())
		}
		tmpl, err := clone.ParseFS(files, "templates/pages/"+entry.Name())
		if err != nil {
			panic("view: parse page " + entry.Name() + ": " + err.Error())
		}
		out[strings.TrimSuffix(entry.Name(), ".html")] = tmpl
	}
	return out
}

// render is the one function that writes a page. Every render function in this
// package delegates to it, so the buffer-before-header rule and the security
// headers are applied once — a new page cannot forget them.
//
// status is a parameter rather than a constant so error pages can carry their
// own — a 404 or 500 rendered as 200 is exactly the "silent success" the
// buffer-first rule exists to prevent.
func render(w http.ResponseWriter, name string, status int, data any) error {
	tmpl, ok := pages[name]
	if !ok {
		return fmt.Errorf("view.render: unknown page %q", name)
	}

	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, "layout.html", data); err != nil {
		return fmt.Errorf("render %s: %w", name, err)
	}

	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, err := w.Write(buf.Bytes())
	return err
}

// LoginPage is what login.html renders. It embeds Page: title, professor and
// CSRF token are handled by the shell, and the page adds only what is unique
// to it — the aviso, the Spanish message shown to a visitor who was refused or
// logged out.
type LoginPage struct {
	Page
	Aviso string
}

// RenderLogin writes the login page.
//
// The status is 200 and is not a parameter. It was one, with a single call site
// passing a single value; the third caller that needs another status is the one
// that should introduce it (#150 review, ARQ-8).
func RenderLogin(w http.ResponseWriter, page LoginPage) error {
	if page.Title == "" {
		if page.Professor != nil {
			page.Title = "Sesión iniciada"
		} else {
			page.Title = "Entrar"
		}
	}
	return render(w, "login", http.StatusOK, page)
}

// RenderProfile writes the professor's own profile page.
//
// status is a parameter for the same reason RenderProfessorsForm's is: the
// same template renders a fresh GET (200) and the re-render after a refused
// token (422). A refusal rendered as 200 would look right in a browser and
// hide the rejection from anything reading the HTTP layer.
func RenderProfile(w http.ResponseWriter, status int, page ProfilePage) error {
	if page.Title == "" {
		page.Title = "Mi perfil"
	}
	return render(w, "profile", status, page)
}

// RenderProfessorsList writes the CRUD's list page.
func RenderProfessorsList(w http.ResponseWriter, page ProfessorsListPage) error {
	if page.Title == "" {
		page.Title = "Profesores"
	}
	return render(w, "professors_list", http.StatusOK, page)
}

// RenderProfessorsForm writes the CRUD's create/edit form.
//
// status is a parameter because this render has two callers with two
// meanings: 200 for a fresh GET, 422 for a re-render after a validation
// refusal. Rendering the refusal as 200 would look right in a browser and
// hide the rejection from anything reading the HTTP layer.
func RenderProfessorsForm(w http.ResponseWriter, status int, page ProfessorsFormPage) error {
	if page.Title == "" {
		page.Title = page.Heading
	}
	if page.Submit == "" {
		page.Submit = "Guardar"
	}
	return render(w, "professors_form", status, page)
}

// RenderControlsList writes the controls list page (S7).
func RenderControlsList(w http.ResponseWriter, page ControlsListPage) error {
	if page.Title == "" {
		page.Title = "Controles"
	}
	return render(w, "controls_list", http.StatusOK, page)
}

// RenderControlsArchived writes the archived-controls list page (issue #261).
func RenderControlsArchived(w http.ResponseWriter, page ControlsArchivedPage) error {
	if page.Title == "" {
		page.Title = "Controles archivados"
	}
	return render(w, "controls_archived", http.StatusOK, page)
}

// RenderControlPurgeConfirm writes the purge confirmation page (issue #261).
// status is 200 on the GET; 422 when re-rendered after a name mismatch, so
// the HTTP layer signals the refusal instead of a green "ok" (same reason
// as RenderControlsForm).
func RenderControlPurgeConfirm(w http.ResponseWriter, status int, page ControlPurgeConfirmPage) error {
	if page.Title == "" {
		page.Title = "Eliminar " + page.Control.Name
	}
	return render(w, "controls_purge_confirm", status, page)
}

// RenderControlsForm writes the create form (S6).
//
// status is a parameter for the same reason RenderProfessorsForm's is:
// 200 for GET, 422 for a validation-failure re-render.
func RenderControlsForm(w http.ResponseWriter, status int, page ControlsFormPage) error {
	if page.Title == "" {
		page.Title = page.Heading
	}
	if page.Submit == "" {
		page.Submit = "Generar control"
	}
	return render(w, "controls_form", status, page)
}

// RenderControlDetail writes one control's detail page (S8).
func RenderControlDetail(w http.ResponseWriter, page ControlDetailPage) error {
	if page.Title == "" {
		page.Title = page.Control.Name
	}
	return render(w, "controls_detail", http.StatusOK, page)
}

// RenderReview writes the WP-F review page.
func RenderReview(w http.ResponseWriter, page ReviewPage) error {
	if page.Title == "" {
		page.Title = fmt.Sprintf("Copia %d — %s", page.CopyNumber, page.Name)
	}
	return render(w, "review", http.StatusOK, page)
}

// RenderError writes an error page through the shell (AC-11).
//
// The status is taken from page.Status: it is what the reader sees and what
// the response carries — a 404 rendered as 200 would look right in the browser
// and be wrong to every cache, script and log line that reads the HTTP layer.
func RenderError(w http.ResponseWriter, page ErrorPage) error {
	if page.Title == "" {
		page.Title = http.StatusText(page.Status)
	}
	return render(w, "error", page.Status, page)
}

// setSecurityHeaders is applied to every page render() writes, which is why it
// lives here rather than in a handler: a new page inherits them without having
// to remember.
//
// What each one is for, since none of them is decoration:
//
//   - no-store, because the signed-in pages carry the professor's address and
//     the session's CSRF token, and the public URL may be http in development —
//     where any intermediary is free to keep a copy.
//   - nosniff, so a rendering bug that emits the wrong bytes cannot be
//     re-interpreted as script.
//   - DENY, because the only form here is logout and framing it is
//     clickjacking with no upside. frame-ancestors says the same thing to
//     browsers that prefer CSP; both are sent because the set of browsers that
//     honour one and not the other is not worth tracking.
//   - same-origin referrers, because the login URL carries an `aviso` parameter
//     and the callback URL carries an authorization code, and neither belongs in
//     a third party's logs because a professor followed a link.
func setSecurityHeaders(w http.ResponseWriter) {
	header := w.Header()
	header.Set("Cache-Control", "no-store")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
	header.Set("Content-Security-Policy", "frame-ancestors 'none'")
	header.Set("Referrer-Policy", "same-origin")
}
