package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
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

// SurveyPathFor builds the URL of one survey's page.
func SurveyPathFor(id int64) string {
	return "/surveys/" + strconv.FormatInt(id, 10)
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
	Service   *survey.Service
	Courses   SurveyCourses
	PublicURL string
	Log       *slog.Logger

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
			URL:     h.landingFor(listed.Survey),
			Summary: surveySummary(listed),
		})
	}
	// Archiving a survey lands here: a redirect target consumes.
	page.Flash = flash.Consume(w, r, h.secureCookie)

	if err := view.RenderSurveysList(w, page); err != nil {
		h.Log.Error("rendering a course's surveys", "course", course.ID, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
	}
}

// surveySummary words one row's bank. "sin pasadas aún" is literal in WP-1:
// runs arrive with WP-2 (#310), which replaces it with a count.
func surveySummary(listed survey.ListedSurvey) string {
	questions := "sin preguntas"
	switch listed.Questions {
	case 0:
	case 1:
		questions = "1 pregunta"
	default:
		questions = fmt.Sprintf("%d preguntas", listed.Questions)
	}
	return questions + " · sin pasadas aún"
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
	http.Redirect(w, r, h.landingFor(created), http.StatusSeeOther)
}

// landingFor is where a survey's link and its creation lead.
func (h *Surveys) landingFor(s survey.Survey) string {
	return SurveyPathFor(s.ID)
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
	_, questions, err := h.Service.Bank(r.Context(), one.ID)
	if err != nil {
		h.Log.Error("reading a survey's bank", "survey", one.ID, "error", err)
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
		EditURL:       SurveyPathFor(one.ID) + "/edit",
		ArchiveAction: SurveyPathFor(one.ID) + "/archive",
		RestoreAction: SurveyPathFor(one.ID) + "/restore",
		NewQuestion:   SurveyPathFor(one.ID) + "/questions/new?kind=" + string(survey.KindSingle),
		QuestionCount: len(questions),
	}
	for _, section := range survey.Sections(questions) {
		rows := make([]view.SurveyQuestionRow, 0, len(section.Questions))
		for _, q := range section.Questions {
			row := questionRow(q)
			base := questionPathFor(one.ID, q.ID)
			row.EditURL = base + "/edit"
			row.PreviewURL = base + "/preview"
			row.DeleteAction = base + "/delete"
			row.MoveAction = base + "/move"
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
	if guide := marksGuide(q.MinMarks, q.MaxMarks); guide != "" {
		row.Alternatives += " · " + guide
	}
	return row
}

// kindLabel is the kind as the professor reads it.
func kindLabel(q survey.Question) string {
	switch q.Kind {
	case survey.KindSingle:
		return "Opción única"
	case survey.KindScale:
		return fmt.Sprintf("Escala 1-%d", len(q.Alternatives))
	case survey.KindMulti:
		return "Selección múltiple"
	}
	return string(q.Kind)
}

// marksGuide words a multi-select question's printed guidance, "" when it
// has none.
func marksGuide(minMarks, maxMarks *int) string {
	switch {
	case minMarks != nil && maxMarks != nil && *minMarks == *maxMarks:
		return fmt.Sprintf("marca %d", *minMarks)
	case minMarks != nil && maxMarks != nil:
		return fmt.Sprintf("marca entre %d y %d", *minMarks, *maxMarks)
	case minMarks != nil && *minMarks > 0:
		return fmt.Sprintf("marca al menos %d", *minMarks)
	case maxMarks != nil:
		return fmt.Sprintf("marca hasta %d", *maxMarks)
	}
	return ""
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
	h.setArchived(w, r, true)
}

// Restore brings an archived survey back and lands on it.
func (h *Surveys) Restore(w http.ResponseWriter, r *http.Request) {
	h.setArchived(w, r, false)
}

func (h *Surveys) setArchived(w http.ResponseWriter, r *http.Request, archive bool) {
	one, ok := h.survey(w, r)
	if !ok {
		return
	}
	var err error
	if archive {
		err = h.Service.Archive(r.Context(), one.ID)
	} else {
		err = h.Service.Restore(r.Context(), one.ID)
	}
	switch {
	case errors.Is(err, survey.ErrSurveyNotFound):
		middleware.WriteError(w, r, http.StatusNotFound, "Esa encuesta no existe.")
		return
	case err != nil:
		h.Log.Error("archiving or restoring a survey", "survey", one.ID, "archive", archive, "error", err)
		middleware.WriteError(w, r, http.StatusInternalServerError, surveyBroke)
		return
	}
	if archive {
		flash.Set(w, h.secureCookie, "Encuesta archivada: «"+one.Name+"». La encuentras en «Ver archivadas».")
		http.Redirect(w, r, CourseSurveysPathFor(one.CourseID), http.StatusSeeOther)
		return
	}
	flash.Set(w, h.secureCookie, "Encuesta restaurada.")
	http.Redirect(w, r, SurveyPathFor(one.ID), http.StatusSeeOther)
}

func (h *Surveys) renderEditForm(w http.ResponseWriter, r *http.Request, one survey.Survey, course roster.Course,
	status int, values view.SurveyFormValues, errs map[string]string, notice string) {
	page := view.SurveyFormPage{
		Page:        middleware.PageFor(r, "Editar encuesta"),
		Heading:     "Editar encuesta",
		Action:      SurveyPathFor(one.ID) + "/edit",
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
	case errors.Is(problem, survey.ErrMarksRange):
		return "El mínimo y el máximo deben estar entre 0 y el número de alternativas, y el mínimo no puede superar al máximo."
	}
	return "Revisa este campo."
}
