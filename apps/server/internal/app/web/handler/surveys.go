package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// The survey screens' routes (epic #308, ADR-0078). English paths, Spanish
// pages. The list and the create form hang off the course a survey belongs
// to; everything after creation is addressed by the survey's own id.
const (
	CourseSurveysPath    = "/courses/{id}/surveys"
	CourseSurveysNewPath = "/courses/{id}/surveys/new"
	SurveyPath           = "/surveys/{id}"
	SurveyEditPath       = "/surveys/{id}/edit"
	SurveyArchivePath    = "/surveys/{id}/archive"
	SurveyRestorePath    = "/surveys/{id}/restore"

	SurveyQuestionsPath       = "/surveys/{id}/questions"
	SurveyQuestionNewPath     = "/surveys/{id}/questions/new"
	SurveyQuestionEditPath    = "/surveys/{id}/questions/{qid}/edit"
	SurveyQuestionDeletePath  = "/surveys/{id}/questions/{qid}/delete"
	SurveyQuestionMovePath    = "/surveys/{id}/questions/{qid}/move"
	SurveyQuestionPreviewPath = "/surveys/{id}/questions/{qid}/preview"
)

// archivedQuery switches the course's survey list to its archived surveys.
const archivedQuery = "archived"

// CourseSurveysPathFor builds the URL of one course's survey list.
func CourseSurveysPathFor(courseID int64) string {
	return CoursePathFor(courseID) + "/surveys"
}

// SurveyPathFor builds the URL of one survey's page. Every other survey
// URL is built from it by the PathFor below — one builder per survey-level
// route, the courses.go shape; the question-level routes share one builder
// that names the action (edit, delete, move, preview).
func SurveyPathFor(id int64) string {
	return "/surveys/" + strconv.FormatInt(id, 10)
}

// SurveyEditPathFor builds the URL of a survey's edit form.
func SurveyEditPathFor(id int64) string { return SurveyPathFor(id) + "/edit" }

// SurveyArchivePathFor builds the URL that archives a survey.
func SurveyArchivePathFor(id int64) string { return SurveyPathFor(id) + "/archive" }

// SurveyRestorePathFor builds the URL that restores an archived survey.
func SurveyRestorePathFor(id int64) string { return SurveyPathFor(id) + "/restore" }

// SurveyQuestionsPathFor builds the URL a new question is POSTed to.
func SurveyQuestionsPathFor(id int64) string { return SurveyPathFor(id) + "/questions" }

// SurveyQuestionNewPathFor builds the URL of the new-question form of a kind.
func SurveyQuestionNewPathFor(id int64, kind survey.QuestionKind) string {
	return SurveyQuestionsPathFor(id) + "/new?" + url.Values{"kind": {string(kind)}}.Encode()
}

// SurveyQuestionPathFor builds the URL of one action on one question:
// "edit", "delete", "move" or "preview".
func SurveyQuestionPathFor(id, questionID int64, action string) string {
	return SurveyQuestionsPathFor(id) + "/" + strconv.FormatInt(questionID, 10) + "/" + action
}

// SurveyQuestionEditKindPathFor builds the edit form of a question
// re-rendered in another kind.
func SurveyQuestionEditKindPathFor(id, questionID int64, kind survey.QuestionKind) string {
	return SurveyQuestionPathFor(id, questionID, "edit") + "?" + url.Values{"kind": {string(kind)}}.Encode()
}

// CourseSurveysNewPathFor builds the URL of the create form.
func CourseSurveysNewPathFor(courseID int64) string {
	return CourseSurveysPathFor(courseID) + "/new"
}

// SurveyCourses is what the survey screens need from the roster domain: the
// course a page is scoped to, for its heading and its 404. Satisfied by
// roster.Service — a narrow port rather than the service, so a survey test
// does not need a Canvas source to render a heading
// (add-a-backend-endpoint.md, issue #272's shape).
type SurveyCourses interface {
	Course(ctx context.Context, id int64) (roster.Course, error)
}

var _ SurveyCourses = (*roster.Service)(nil)

// Surveys holds the survey screens.
type Surveys struct {
	Service *survey.Service
	Courses SurveyCourses
	// Jobs and Runner are the one job queue (ADR-0079): a run's page reads
	// its banner from Jobs, and creating a run submits to Runner — the
	// handler.Controls shape.
	Jobs      jobs.Store
	Runner    *jobs.Runner
	PublicURL string
	Log       *slog.Logger
	// MaxScanBytes bounds one uploaded batch (issue #311) — the controls'
	// limit, NALANDA_MAX_SCAN_BYTES. Zero means no limit.
	MaxScanBytes int64

	// secureCookie is DERIVED from PublicURL by NewSurveys, never passed in
	// — same reasoning as Courses.secureCookie.
	secureCookie bool
}

// NewSurveys returns the handlers, or panics at wiring time on a missing
// dependency.
func NewSurveys(deps Surveys) *Surveys {
	switch {
	case deps.Service == nil:
		panic("handler.NewSurveys: no survey service")
	case deps.Courses == nil:
		panic("handler.NewSurveys: no course reader")
	case deps.Jobs == nil:
		panic("handler.NewSurveys: no jobs store")
	case deps.Runner == nil:
		panic("handler.NewSurveys: no job runner")
	case deps.PublicURL == "":
		panic("handler.NewSurveys: no public URL — the flash cookie's Secure attribute is derived from it")
	case deps.Log == nil:
		panic("handler.NewSurveys: no logger")
	}
	deps.secureCookie = config.SecureFor(deps.PublicURL)
	return &deps
}

const surveyBroke = "Algo se rompió en el servidor. Vuelve a intentarlo en unos segundos."

// ListForCourse renders one course's surveys (screen 1): the active ones,
// or the archived ones with ?archived=1.
func (h *Surveys) ListForCourse(w http.ResponseWriter, r *http.Request) {
	course, ok := h.course(w, r)
	if !ok {
		return
	}
	surveys, err := h.Service.SurveysForCourse(r.Context(), course.ID)
	if err != nil {
		h.Log.Error("listing a course's surveys", "course", course.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	runSums, err := h.Service.RunSummaries(r.Context(), course.ID)
	if err != nil {
		h.Log.Error("summarising a course's runs", "course", course.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}

	showArchived := r.URL.Query().Get(archivedQuery) == "1"
	page := view.SurveysListPage{
		Page:            middleware.PageFor(r, course.Code+" · encuestas"),
		Course:          listedCourse(course),
		NewURL:          CourseSurveysNewPathFor(course.ID),
		ShowingArchived: showArchived,
		ArchivedCount:   len(surveys.Archived),
		ToggleURL:       CourseSurveysPathFor(course.ID) + "?" + archivedQuery + "=1",
	}
	rows := surveys.Active
	if showArchived {
		rows = surveys.Archived
		page.ToggleURL = CourseSurveysPathFor(course.ID)
	}
	for _, listed := range rows {
		page.Surveys = append(page.Surveys, view.ListedSurveyRow{
			Name:    listed.Survey.Name,
			URL:     SurveyPathFor(listed.Survey.ID),
			Summary: surveySummary(listed, runSums[listed.Survey.ID]),
		})
	}
	// Archiving a survey lands here: a redirect target consumes.
	page.Flash = flash.Consume(w, r, h.secureCookie)

	if err := view.RenderSurveysList(w, page); err != nil {
		h.Log.Error("rendering a course's surveys", "course", course.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
}

// surveySummary words one row: its bank, and its runs that are not
// cancelled with the latest date among them.
func surveySummary(listed survey.ListedSurvey, runs survey.RunSummary) string {
	questions := "sin preguntas"
	switch listed.Questions {
	case 0:
	case 1:
		questions = "1 pregunta"
	default:
		questions = fmt.Sprintf("%d preguntas", listed.Questions)
	}
	switch runs.Runs {
	case 0:
		return questions + " · sin pasadas aún"
	case 1:
		return questions + " · 1 pasada · última: " + runs.LastAppliedOn
	}
	return fmt.Sprintf("%s · %d pasadas · última: %s", questions, runs.Runs, runs.LastAppliedOn)
}

// New renders the empty create form (screen 2).
func (h *Surveys) New(w http.ResponseWriter, r *http.Request) {
	course, ok := h.course(w, r)
	if !ok {
		return
	}
	h.renderCreateForm(w, r, course, http.StatusOK, view.SurveyFormValues{}, nil, "")
}

// Create stores a new survey under the course.
func (h *Surveys) Create(w http.ResponseWriter, r *http.Request) {
	course, ok := h.course(w, r)
	if !ok {
		return
	}
	if err := r.ParseForm(); err != nil {
		h.renderCreateForm(w, r, course, http.StatusUnprocessableEntity, view.SurveyFormValues{}, nil,
			"No se pudo leer el formulario. Vuelve a intentarlo.")
		return
	}
	values := view.SurveyFormValues{Name: r.PostFormValue("name"), Description: r.PostFormValue("description")}

	professor, ok := middleware.ProfessorFrom(r.Context())
	if !ok {
		// Unreachable behind RequireProfessor; a page rather than a panic.
		middleware.WriteError(w, r, http.StatusForbidden, "Necesitas iniciar sesión.")
		return
	}

	created, err := h.Service.CreateSurvey(r.Context(), course.ID, professor.ID,
		survey.SurveyDraft{Name: values.Name, Description: values.Description})
	switch {
	case errors.Is(err, survey.ErrInvalid):
		h.renderCreateForm(w, r, course, http.StatusUnprocessableEntity, values, surveyFieldErrors(err), "")
		return
	case errors.Is(err, survey.ErrCourseNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Ese curso no existe.")
		return
	case err != nil:
		h.Log.Error("creating a survey", "course", course.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}

	flash.Set(w, h.secureCookie, "Encuesta creada. Ahora agrégale preguntas.")
	http.Redirect(w, r, SurveyPathFor(created.ID), http.StatusSeeOther)
}

// Detail renders one survey: its bank, grouped by section, and its runs
// (screen 3).
func (h *Surveys) Detail(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	course, ok := h.courseOf(w, r, one)
	if !ok {
		return
	}
	questions, err := h.Service.Questions(r.Context(), one.ID)
	if err != nil {
		h.Log.Error("reading a survey's bank", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	runs, err := h.Service.Runs(r.Context(), one.ID)
	if err != nil {
		h.Log.Error("reading a survey's runs", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}

	page := view.SurveyDetailPage{
		Page:          middleware.PageFor(r, one.Name),
		Course:        listedCourse(course),
		ListURL:       CourseSurveysPathFor(course.ID),
		Name:          one.Name,
		Description:   one.Description,
		Archived:      one.Archived(),
		EditURL:       SurveyEditPathFor(one.ID),
		ArchiveAction: SurveyArchivePathFor(one.ID),
		RestoreAction: SurveyRestorePathFor(one.ID),
		NewQuestion:   SurveyQuestionNewPathFor(one.ID, survey.KindSingle),
		NewRunURL:     SurveyRunNewPathFor(one.ID),
		QuestionCount: len(questions),
	}
	for _, run := range runs {
		page.Locked = page.Locked || run.LocksBank()
		label := "Pasada #" + strconv.Itoa(run.Number)
		if run.Name != "" {
			label += " · " + run.Name
		}
		page.Runs = append(page.Runs, view.ListedRun{
			Label:     label,
			Meta:      fmt.Sprintf("%s · %d copias · %s", run.AppliedOn, run.Copies, runStateLabel(run.State)),
			URL:       SurveyRunPathFor(one.ID, run.ID),
			Cancelled: run.State == survey.RunCancelled,
		})
	}
	for _, section := range survey.Sections(questions) {
		rows := make([]view.SurveyQuestionRow, 0, len(section.Questions))
		for _, q := range section.Questions {
			row := questionRow(q)
			row.EditURL = SurveyQuestionPathFor(one.ID, q.ID, "edit")
			row.PreviewURL = SurveyQuestionPathFor(one.ID, q.ID, "preview")
			row.DeleteAction = SurveyQuestionPathFor(one.ID, q.ID, "delete")
			row.MoveAction = SurveyQuestionPathFor(one.ID, q.ID, "move")
			row.First = q.Position == 1
			row.Last = q.Position == len(questions)
			rows = append(rows, row)
		}
		page.Sections = append(page.Sections, view.SurveySection{Label: section.Label, Questions: rows})
	}
	page.Flash = flash.Consume(w, r, h.secureCookie)

	if err := view.RenderSurveyDetail(w, page); err != nil {
		h.Log.Error("rendering a survey", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
}

// questionRow words one question for the bank list.
func questionRow(q survey.Question) view.SurveyQuestionRow {
	row := view.SurveyQuestionRow{
		Number:    q.Position,
		Statement: q.Statement,
		KindLabel: kindLabel(q),
		IsContext: q.IsContext,
	}
	if q.Kind != survey.KindScale {
		labels := make([]string, len(q.Alternatives))
		for i, a := range q.Alternatives {
			labels[i] = a.Label
		}
		row.Alternatives = strings.Join(labels, " · ")
	}
	if guide := survey.MarksGuide(q.MinMarks, q.MaxMarks); guide != "" {
		row.Alternatives += " · " + guide
	}
	return row
}

// kindLabel is a stored question's kind as the bank lists it: the kind's
// name, and a scale's range.
func kindLabel(q survey.Question) string {
	if q.Kind == survey.KindScale {
		return fmt.Sprintf("Escala 1-%d", len(q.Alternatives))
	}
	return kindName(q.Kind)
}

// Edit renders the survey form pre-filled.
func (h *Surveys) Edit(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	course, ok := h.courseOf(w, r, one)
	if !ok {
		return
	}
	h.renderEditForm(w, r, one, course, http.StatusOK,
		view.SurveyFormValues{Name: one.Name, Description: one.Description}, nil, "")
}

// Update rewrites the survey's name and description.
func (h *Surveys) Update(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	course, ok := h.courseOf(w, r, one)
	if !ok {
		return
	}
	if err := r.ParseForm(); err != nil {
		h.renderEditForm(w, r, one, course, http.StatusUnprocessableEntity,
			view.SurveyFormValues{}, nil, "No se pudo leer el formulario. Vuelve a intentarlo.")
		return
	}
	values := view.SurveyFormValues{Name: r.PostFormValue("name"), Description: r.PostFormValue("description")}
	err := h.Service.UpdateSurvey(r.Context(), one.ID, survey.SurveyDraft{Name: values.Name, Description: values.Description})
	switch {
	case errors.Is(err, survey.ErrInvalid):
		h.renderEditForm(w, r, one, course, http.StatusUnprocessableEntity, values, surveyFieldErrors(err), "")
		return
	case errors.Is(err, survey.ErrSurveyNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa encuesta no existe.")
		return
	case err != nil:
		h.Log.Error("updating a survey", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	flash.Set(w, h.secureCookie, "Encuesta actualizada.")
	http.Redirect(w, r, SurveyPathFor(one.ID), http.StatusSeeOther)
}

// Archive hides the survey from its course's list and lands on the list.
func (h *Surveys) Archive(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	if h.surveyWriteFailed(w, r, one, "archiving a survey", h.Service.Archive(r.Context(), one.ID)) {
		return
	}
	flash.Set(w, h.secureCookie, "Encuesta archivada: «"+one.Name+"». La encuentras en «Ver archivadas».")
	http.Redirect(w, r, CourseSurveysPathFor(one.CourseID), http.StatusSeeOther)
}

// Restore brings an archived survey back and lands on it.
func (h *Surveys) Restore(w http.ResponseWriter, r *http.Request) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	if h.surveyWriteFailed(w, r, one, "restoring a survey", h.Service.Restore(r.Context(), one.ID)) {
		return
	}
	flash.Set(w, h.secureCookie, "Encuesta restaurada.")
	http.Redirect(w, r, SurveyPathFor(one.ID), http.StatusSeeOther)
}

// surveyWriteFailed answers a failed survey-level write and reports whether
// it did.
func (h *Surveys) surveyWriteFailed(w http.ResponseWriter, r *http.Request, one survey.Survey, what string, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, survey.ErrSurveyNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa encuesta no existe.")
	default:
		h.Log.Error(what, "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
	return true
}

func (h *Surveys) renderEditForm(w http.ResponseWriter, r *http.Request, one survey.Survey, course roster.Course,
	status int, values view.SurveyFormValues, errs map[string]string, notice string) {
	page := view.SurveyFormPage{
		Page:        middleware.PageFor(r, "Editar encuesta"),
		Heading:     "Editar encuesta",
		Action:      SurveyEditPathFor(one.ID),
		Submit:      "Guardar",
		CancelURL:   SurveyPathFor(one.ID),
		CourseLabel: course.Code + " " + course.Term,
		Values:      values,
		Errors:      errs,
		Notice:      notice,
	}
	if err := view.RenderSurveyForm(w, status, page); err != nil {
		h.Log.Error("rendering the survey form", "survey", one.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
}

// survey reads the {id} survey of the request, answering 404 itself when
// there is none.
func (h *Surveys) survey(w http.ResponseWriter, r *http.Request) (survey.Survey, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		middleware.WriteError(w, r, http.StatusNotFound, "Esa encuesta no existe.")
		return survey.Survey{}, false
	}
	one, err := h.Service.Survey(r.Context(), id)
	switch {
	case errors.Is(err, survey.ErrSurveyNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa encuesta no existe.")
		return survey.Survey{}, false
	case err != nil:
		h.Log.Error("reading a survey", "survey", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return survey.Survey{}, false
	}
	return one, true
}

// courseOf reads the course a survey belongs to. Its absence is a broken
// reference (the schema's RESTRICT forbids it), so it is a 500, not a 404.
func (h *Surveys) courseOf(w http.ResponseWriter, r *http.Request, one survey.Survey) (roster.Course, bool) {
	course, err := h.Courses.Course(r.Context(), one.CourseID)
	if err != nil {
		h.Log.Error("reading a survey's course", "survey", one.ID, "course", one.CourseID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return roster.Course{}, false
	}
	return course, true
}

func (h *Surveys) renderCreateForm(w http.ResponseWriter, r *http.Request, course roster.Course, status int,
	values view.SurveyFormValues, errs map[string]string, notice string) {
	page := view.SurveyFormPage{
		Page:        middleware.PageFor(r, "Nueva encuesta"),
		Heading:     "Nueva encuesta",
		Action:      CourseSurveysPathFor(course.ID),
		Submit:      "Crear",
		CancelURL:   CourseSurveysPathFor(course.ID),
		CourseLabel: course.Code + " " + course.Term,
		Values:      values,
		Errors:      errs,
		Notice:      notice,
	}
	if err := view.RenderSurveyForm(w, status, page); err != nil {
		h.Log.Error("rendering the survey form", "course", course.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
}

// course reads the {id} course of the request, answering 404 itself when
// there is none.
func (h *Surveys) course(w http.ResponseWriter, r *http.Request) (roster.Course, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		middleware.WriteError(w, r, http.StatusNotFound, "Ese curso no existe.")
		return roster.Course{}, false
	}
	course, err := h.Courses.Course(r.Context(), id)
	switch {
	case errors.Is(err, roster.ErrCourseNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Ese curso no existe.")
		return roster.Course{}, false
	case err != nil:
		h.Log.Error("reading a course", "course", id, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return roster.Course{}, false
	}
	return course, true
}

func listedCourse(c roster.Course) view.ListedCourse {
	return view.ListedCourse{Code: c.Code, Name: c.Name, Term: c.Term, URL: CoursePathFor(c.ID)}
}

// surveyFieldErrors turns a ValidationError's sentinels into the Spanish
// line each field shows. The domain names WHAT broke; the words a professor
// reads live here, on the surface that renders them.
func surveyFieldErrors(err error) map[string]string {
	var v *survey.ValidationError
	if !errors.As(err, &v) {
		return nil
	}
	out := make(map[string]string, len(v.Problems))
	for field, problem := range v.Problems {
		out[field] = surveyProblemMessage(field, problem)
	}
	return out
}

func surveyProblemMessage(field string, problem error) string {
	switch {
	case errors.Is(problem, survey.ErrRequired):
		switch field {
		case survey.FieldName:
			return "Escribe un nombre."
		case survey.FieldStatement:
			return "Escribe el enunciado."
		case survey.FieldAppliedOn:
			return "Elige la fecha de aplicación."
		}
		return "Este campo es obligatorio."
	case errors.Is(problem, survey.ErrTooLong):
		switch field {
		case survey.FieldName:
			return fmt.Sprintf("El nombre es demasiado largo (máximo %d caracteres).", survey.MaxNameLength)
		case survey.FieldDescription:
			return fmt.Sprintf("La descripción es demasiado larga (máximo %d caracteres).", survey.MaxDescriptionLength)
		case survey.FieldStatement:
			return fmt.Sprintf("El enunciado es demasiado largo (máximo %d caracteres).", survey.MaxStatementLength)
		case survey.FieldSection:
			return fmt.Sprintf("La sección es demasiado larga (máximo %d caracteres).", survey.MaxSectionLength)
		case survey.FieldAlternatives:
			return fmt.Sprintf("Alguna alternativa es demasiado larga (máximo %d caracteres).", survey.MaxLabelLength)
		}
		return "Es demasiado largo."
	case errors.Is(problem, survey.ErrUnknownKind):
		return "Elige un tipo de pregunta."
	case errors.Is(problem, survey.ErrTooFewAlternatives):
		return fmt.Sprintf("Escribe al menos %d alternativas.", survey.MinAlternatives)
	case errors.Is(problem, survey.ErrTooManyAlternatives):
		return fmt.Sprintf("Puedes escribir como máximo %d alternativas.", survey.MaxAlternatives)
	case errors.Is(problem, survey.ErrDuplicateAlternative):
		return "Hay dos alternativas iguales; en la hoja no se podrían distinguir."
	case errors.Is(problem, survey.ErrScalePoints):
		return fmt.Sprintf("Una escala tiene entre %d y %d puntos.", survey.MinScalePoints, survey.MaxScalePoints)
	case errors.Is(problem, survey.ErrContextKind):
		return "Solo una pregunta de opción única puede ser de contexto."
	case errors.Is(problem, survey.ErrMarksNotAllowed):
		return "El mínimo y el máximo de marcas solo aplican a selección múltiple."
	case errors.Is(problem, survey.ErrBadDate):
		return "Escribe una fecha válida."
	case errors.Is(problem, survey.ErrCopiesRange):
		return fmt.Sprintf("Las copias van de %d a %d.", survey.MinCopies, survey.MaxCopies)
	case errors.Is(problem, survey.ErrMarksRange):
		return "El mínimo va de 0 al número de alternativas, el máximo de 1 al número de alternativas, y el mínimo no puede superar al máximo."
	}
	return "Revisa este campo."
}
