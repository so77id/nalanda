package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// The question screens of a survey's bank (issue #309 S6, screens 4 and
// 4b): create, edit, delete and move. A file of their own beside
// surveys.go because the form's three shapes are most of the code.

// The form's fixed rows. Ten alternative inputs is MaxAlternatives; seven
// scale labels is MaxScalePoints. Fixed rows are what lets the form work
// without JavaScript — blank alternatives are dropped by the domain, and a
// scale uses its first Points labels.
const (
	formAlternativeRows = survey.MaxAlternatives
	formScaleRows       = survey.MaxScalePoints
	defaultScalePoints  = 5
)

// NewQuestion renders an empty question form of the ?kind= kind.
func (h *Surveys) NewQuestion(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	kind := kindFromQuery(r)
	values := view.QuestionFormValues{Kind: string(kind)}
	fillRows(&values, nil, nil)
	if kind == survey.KindScale {
		values.Points = defaultScalePoints
		values.ScaleLabels = padTo(survey.DefaultScaleLabels(defaultScalePoints), formScaleRows)
	}
	h.renderQuestionForm(w, r, one, 0, http.StatusOK, values, nil, "")
}

// CreateQuestion appends a question to the bank.
func (h *Surveys) CreateQuestion(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	draft, values, errs, ok := h.readQuestionForm(w, r, one, 0)
	if !ok {
		return
	}
	if errs != nil {
		h.renderQuestionForm(w, r, one, 0, http.StatusUnprocessableEntity, values, withDraftProblems(errs, draft), "")
		return
	}
	_, err := h.Service.AddQuestion(r.Context(), one.ID, draft)
	if h.questionWriteFailed(w, r, one, 0, values, err) {
		return
	}
	flash.Set(w, h.secureCookie, "Pregunta agregada.")
	http.Redirect(w, r, SurveyPathFor(one.ID), http.StatusSeeOther)
}

// EditQuestion renders the form pre-filled with a stored question. A ?kind=
// different from the stored one re-renders the form in that kind, keeping
// what carries over (statement, section, labels).
func (h *Surveys) EditQuestion(w http.ResponseWriter, r *http.Request) {
	one, q, ok := h.surveyQuestion(w, r)
	if !ok {
		return
	}
	values := view.QuestionFormValues{
		Kind:      string(q.Kind),
		Statement: q.Statement,
		Section:   q.Section,
		IsContext: q.IsContext,
	}
	if r.URL.Query().Has("kind") {
		values.Kind = string(kindFromQuery(r))
	}
	labels := make([]string, len(q.Alternatives))
	for i, a := range q.Alternatives {
		labels[i] = a.Label
	}
	fillRows(&values, labels, labels)
	values.Points = len(labels)
	if values.Kind == string(survey.KindScale) && (values.Points < survey.MinScalePoints || values.Points > survey.MaxScalePoints) {
		values.Points = defaultScalePoints
	}
	if q.MinMarks != nil {
		values.MinMarks = strconv.Itoa(*q.MinMarks)
	}
	if q.MaxMarks != nil {
		values.MaxMarks = strconv.Itoa(*q.MaxMarks)
	}
	h.renderQuestionForm(w, r, one, q.ID, http.StatusOK, values, nil, "")
}

// UpdateQuestion rewrites a stored question.
func (h *Surveys) UpdateQuestion(w http.ResponseWriter, r *http.Request) {
	one, q, ok := h.surveyQuestion(w, r)
	if !ok {
		return
	}
	draft, values, errs, ok := h.readQuestionForm(w, r, one, q.ID)
	if !ok {
		return
	}
	if errs != nil {
		h.renderQuestionForm(w, r, one, q.ID, http.StatusUnprocessableEntity, values, withDraftProblems(errs, draft), "")
		return
	}
	err := h.Service.UpdateQuestion(r.Context(), one.ID, q.ID, draft)
	if h.questionWriteFailed(w, r, one, q.ID, values, err) {
		return
	}
	flash.Set(w, h.secureCookie, "Pregunta actualizada.")
	http.Redirect(w, r, SurveyPathFor(one.ID), http.StatusSeeOther)
}

// DeleteQuestion removes a question from the bank.
func (h *Surveys) DeleteQuestion(w http.ResponseWriter, r *http.Request) {
	one, q, ok := h.surveyQuestion(w, r)
	if !ok {
		return
	}
	err := h.Service.DeleteQuestion(r.Context(), one.ID, q.ID)
	if h.questionActionFailed(w, r, one, err) {
		return
	}
	flash.Set(w, h.secureCookie, "Pregunta "+strconv.Itoa(q.Position)+" borrada.")
	http.Redirect(w, r, SurveyPathFor(one.ID), http.StatusSeeOther)
}

// MoveQuestion moves a question one step; the form says dir=up or down.
func (h *Surveys) MoveQuestion(w http.ResponseWriter, r *http.Request) {
	one, q, ok := h.surveyQuestion(w, r)
	if !ok {
		return
	}
	delta := 0
	switch r.PostFormValue("dir") {
	case "up":
		delta = -1
	case "down":
		delta = 1
	default:
		middleware.WriteError(w, r, http.StatusUnprocessableEntity, "No se entendió hacia dónde mover la pregunta.")
		return
	}
	err := h.Service.MoveQuestion(r.Context(), one.ID, q.ID, delta)
	if h.questionActionFailed(w, r, one, err) {
		return
	}
	http.Redirect(w, r, SurveyPathFor(one.ID)+"#banco", http.StatusSeeOther)
}

// readQuestionForm parses the POSTed form into a draft and the values to
// render back. errs is non-nil when the form itself is unusable before the
// domain is asked (an unparsable number); ok is false when a response has
// already been written.
func (h *Surveys) readQuestionForm(w http.ResponseWriter, r *http.Request, one survey.Survey, questionID int64) (
	survey.QuestionDraft, view.QuestionFormValues, map[string]string, bool) {
	if err := r.ParseForm(); err != nil {
		values := view.QuestionFormValues{Kind: string(survey.KindSingle)}
		fillRows(&values, nil, nil)
		h.renderQuestionForm(w, r, one, questionID, http.StatusUnprocessableEntity, values, nil,
			"No se pudo leer el formulario. Vuelve a intentarlo.")
		return survey.QuestionDraft{}, view.QuestionFormValues{}, nil, false
	}

	kind := survey.QuestionKind(r.PostFormValue("kind"))
	values := view.QuestionFormValues{
		Kind:      string(kind),
		Statement: r.PostFormValue("statement"),
		Section:   r.PostFormValue("section"),
		IsContext: r.PostFormValue("is_context") == "1",
		MinMarks:  strings.TrimSpace(r.PostFormValue("min_marks")),
		MaxMarks:  strings.TrimSpace(r.PostFormValue("max_marks")),
	}
	fillRows(&values, r.PostForm["alternative"], r.PostForm["scale_label"])
	values.Points, _ = strconv.Atoi(r.PostFormValue("points"))

	draft := survey.QuestionDraft{
		Kind:      kind,
		Statement: values.Statement,
		Section:   values.Section,
		IsContext: values.IsContext,
	}
	switch kind {
	case survey.KindScale:
		// The form always sends seven labels; the scale is the first Points
		// of them. An out-of-range Points is handed through as that many
		// labels so the domain's ErrScalePoints is what refuses it.
		points := values.Points
		if points < 0 {
			points = 0
		}
		draft.Labels = padTo(values.ScaleLabels, points)
	default:
		draft.Labels = values.Alternatives
	}

	errs := map[string]string{}
	if kind == survey.KindMulti {
		var bad bool
		draft.MinMarks, bad = optionalInt(values.MinMarks)
		if bad {
			errs[survey.FieldMarks] = "Escribe un número entero, o déjalo vacío."
		}
		draft.MaxMarks, bad = optionalInt(values.MaxMarks)
		if bad {
			errs[survey.FieldMarks] = "Escribe un número entero, o déjalo vacío."
		}
	}
	if len(errs) > 0 {
		return draft, values, errs, true
	}
	return draft, values, nil, true
}

// withDraftProblems adds to a form's own parse errors every problem the
// domain finds in the rest of the draft, so an unparsable number does not
// hide a blank statement until the next submit (#309 review, COR-3). The
// parse error wins on its own field: it is the more specific sentence.
func withDraftProblems(errs map[string]string, draft survey.QuestionDraft) map[string]string {
	_, err := draft.Normalize()
	for field, message := range surveyFieldErrors(err) {
		if _, taken := errs[field]; !taken {
			errs[field] = message
		}
	}
	return errs
}

// questionWriteFailed answers a refused or failed create/update and
// reports whether it did.
func (h *Surveys) questionWriteFailed(w http.ResponseWriter, r *http.Request, one survey.Survey, questionID int64,
	values view.QuestionFormValues, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, survey.ErrInvalid):
		h.renderQuestionForm(w, r, one, questionID, http.StatusUnprocessableEntity, values, surveyFieldErrors(err), "")
	case errors.Is(err, survey.ErrSurveyNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa encuesta no existe.")
	case errors.Is(err, survey.ErrQuestionNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa pregunta no existe.")
	default:
		h.Log.Error("writing a survey question", "survey", one.ID, "question", questionID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
	return true
}

// questionActionFailed is the same for delete and move, which render no
// form: a vanished question is a flash on the survey page, because a
// double-clicked Borrar must not read as a crash.
func (h *Surveys) questionActionFailed(w http.ResponseWriter, r *http.Request, one survey.Survey, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, survey.ErrQuestionNotFound):
		flash.Set(w, h.secureCookie, "Esa pregunta ya no está en el banco.")
		http.Redirect(w, r, SurveyPathFor(one.ID), http.StatusSeeOther)
	case errors.Is(err, survey.ErrSurveyNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa encuesta no existe.")
	default:
		h.Log.Error("changing a survey's bank", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
	return true
}

func (h *Surveys) renderQuestionForm(w http.ResponseWriter, r *http.Request, one survey.Survey, questionID int64,
	status int, values view.QuestionFormValues, errs map[string]string, notice string) {
	heading, action, submit := "Nueva pregunta", SurveyQuestionsPathFor(one.ID), "Guardar"
	kindURL := func(kind survey.QuestionKind) string { return SurveyQuestionNewPathFor(one.ID, kind) }
	previewURL := ""
	if questionID != 0 {
		heading = "Editar pregunta"
		action = SurveyQuestionPathFor(one.ID, questionID, "edit")
		kindURL = func(kind survey.QuestionKind) string {
			return SurveyQuestionEditKindPathFor(one.ID, questionID, kind)
		}
		previewURL = SurveyQuestionPathFor(one.ID, questionID, "preview")
	}

	page := view.SurveyQuestionFormPage{
		Page:         middleware.PageFor(r, heading),
		SurveyName:   one.Name,
		Heading:      heading,
		Action:       action,
		Submit:       submit,
		CancelURL:    SurveyPathFor(one.ID),
		PreviewURL:   previewURL,
		PointOptions: scalePointOptions(),
		Values:       values,
		Errors:       errs,
		Notice:       notice,
	}
	for _, kind := range survey.Kinds {
		page.KindLinks = append(page.KindLinks, view.KindLink{
			Label:   kindName(kind),
			URL:     kindURL(kind),
			Current: string(kind) == values.Kind,
		})
	}
	// The sections already used in this bank, offered as suggestions so a
	// label is not retyped with a different spelling — two spellings would
	// be two headings.
	// A failed read costs only the suggestions, so the form still renders.
	questions, err := h.Service.Questions(r.Context(), one.ID)
	if err != nil {
		h.Log.Warn("reading the bank for section suggestions", "survey", one.ID, "error", err)
	}
	seen := map[string]bool{}
	for _, q := range questions {
		if q.Section != "" && !seen[q.Section] {
			seen[q.Section] = true
			page.KnownSections = append(page.KnownSections, q.Section)
		}
	}

	if err := view.RenderSurveyQuestionForm(w, status, page); err != nil {
		h.Log.Error("rendering the question form", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
}

// surveyQuestion reads the {id} survey and its {qid} question, answering
// 404 itself when either is absent — including a question of ANOTHER
// survey reached through this one's URL.
func (h *Surveys) surveyQuestion(w http.ResponseWriter, r *http.Request) (survey.Survey, survey.Question, bool) {
	one, ok := h.survey(w, r)
	if !ok {
		return survey.Survey{}, survey.Question{}, false
	}
	qid, err := strconv.ParseInt(r.PathValue("qid"), 10, 64)
	if err != nil || qid <= 0 {
		middleware.WriteError(w, r, http.StatusNotFound, "Esa pregunta no existe.")
		return survey.Survey{}, survey.Question{}, false
	}
	q, err := h.Service.Question(r.Context(), one.ID, qid)
	switch {
	case errors.Is(err, survey.ErrQuestionNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa pregunta no existe.")
		return survey.Survey{}, survey.Question{}, false
	case err != nil:
		h.Log.Error("reading a survey question", "survey", one.ID, "question", qid, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return survey.Survey{}, survey.Question{}, false
	}
	return one, q, true
}

// kindFromQuery reads ?kind=, falling back to single choice for anything
// it does not know — the selector's links are the only legitimate source.
func kindFromQuery(r *http.Request) survey.QuestionKind {
	kind := survey.QuestionKind(r.URL.Query().Get("kind"))
	if !kind.Valid() {
		return survey.KindSingle
	}
	return kind
}

// kindName is a kind's name on the selector.
func kindName(kind survey.QuestionKind) string {
	switch kind {
	case survey.KindSingle:
		return "Opción única"
	case survey.KindScale:
		return "Escala"
	case survey.KindMulti:
		return "Selección múltiple"
	}
	return string(kind)
}

// scalePointOptions is the points select, derived from the domain's bounds.
func scalePointOptions() []int {
	var out []int
	for n := survey.MinScalePoints; n <= survey.MaxScalePoints; n++ {
		out = append(out, n)
	}
	return out
}

// fillRows sets the form's fixed rows from what it has, blank-padded.
func fillRows(values *view.QuestionFormValues, alternatives, scaleLabels []string) {
	values.Alternatives = padTo(alternatives, formAlternativeRows)
	values.ScaleLabels = padTo(scaleLabels, formScaleRows)
}

// padTo returns a copy of labels with exactly n entries: truncated, or
// padded with "".
func padTo(labels []string, n int) []string {
	out := make([]string, n)
	copy(out, labels)
	return out
}

// optionalInt reads an optional integer field: "" is nil, a number is its
// value, anything else is bad.
func optionalInt(raw string) (*int, bool) {
	if raw == "" {
		return nil, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return nil, true
	}
	return &n, false
}

// PreviewQuestion renders an HTML approximation of one printed question
// (screen 5). An approximation and labelled as one: the real sheet is
// AMC's, and it is generated with a run (WP-2) — this WP calls no worker.
func (h *Surveys) PreviewQuestion(w http.ResponseWriter, r *http.Request) {
	one, q, ok := h.surveyQuestion(w, r)
	if !ok {
		return
	}
	page := view.SurveyQuestionPreviewPage{
		Page:       middleware.PageFor(r, "Previsualización"),
		SurveyName: one.Name,
		BackURL:    SurveyPathFor(one.ID),
		EditURL:    SurveyQuestionPathFor(one.ID, q.ID, "edit"),
		Number:     q.Position,
		Statement:  q.Statement,
		Horizontal: q.Kind == survey.KindScale,
		Guide:      marksGuide(q.MinMarks, q.MaxMarks),
	}
	for i, a := range q.Alternatives {
		letter := string(rune('A' + i))
		if q.Kind == survey.KindScale {
			letter = strconv.Itoa(a.Position)
		}
		page.Options = append(page.Options, view.PreviewOption{Letter: letter, Label: a.Label})
	}
	if err := view.RenderSurveyQuestionPreview(w, page); err != nil {
		h.Log.Error("rendering a question preview", "survey", one.ID, "question", q.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
}
