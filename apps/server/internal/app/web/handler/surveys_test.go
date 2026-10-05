package handler_test

import (
	"bytes"
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/coursestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/surveystore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// The survey screens (epic #308) against the real database: the survey
// store, the course store and the session all over one temp SQLite file,
// behind the same Resolve + RequireProfessor the router applies.

type surveyFixture struct {
	t          *testing.T
	db         *sql.DB
	store      *authstore.Store
	surveys    *survey.Service
	handler    *handler.Surveys
	middleware *middleware.Auth
	logs       *bytes.Buffer
	now        time.Time
	professor  auth.User
	session    string
	courseID   int64
}

func newSurveyFixture(t *testing.T) *surveyFixture {
	t.Helper()

	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	logs := &bytes.Buffer{}
	log := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	f := &surveyFixture{
		t:     t,
		db:    db,
		store: authstore.New(db),
		logs:  logs,
		now:   time.Date(2026, time.October, 5, 12, 0, 0, 0, time.UTC),
	}
	courses := coursestore.New(db)
	course, err := courses.CreateCourse(ctx, roster.Course{
		Name: "Estructuras de Datos", Code: "CIT2006-03", Term: "2026-2", CanvasCourseID: "44779",
	})
	if err != nil {
		t.Fatalf("CreateCourse: %v", err)
	}
	f.courseID = course.ID

	f.surveys = survey.NewService(survey.Service{Store: surveystore.New(db), Now: func() time.Time { return f.now }})
	f.handler = handler.NewSurveys(handler.Surveys{
		Service:   f.surveys,
		Courses:   roster.NewService(courses, stubCourseSource{}),
		PublicURL: publicURL,
		Log:       log,
	})
	f.middleware = middleware.NewAuth(middleware.Auth{
		Sessions: f.store, Users: f.store, Now: func() time.Time { return f.now },
		PublicURL: publicURL, LoginPath: handler.LoginPath, Log: log,
	})
	f.professor, f.session = f.signIn()
	return f
}

func (f *surveyFixture) signIn() (auth.User, string) {
	f.t.Helper()
	ctx := context.Background()
	user, err := f.store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		f.t.Fatalf("CreateUser: %v", err)
	}
	token, _ := auth.NewToken()
	csrf, _ := auth.NewToken()
	if err := f.store.CreateSession(ctx, auth.Session{
		TokenHash: auth.HashToken(token), UserID: user.ID, CSRFToken: csrf,
		CreatedAt: f.now, ExpiresAt: f.now.Add(time.Hour), LastSeenAt: f.now,
	}); err != nil {
		f.t.Fatalf("CreateSession: %v", err)
	}
	return user, token
}

// do drives one request through the gate. pathValues are bound the way the
// mux binds them in production.
func (f *surveyFixture) do(method, target string, h http.HandlerFunc, form url.Values, pathValues ...string) *httptest.ResponseRecorder {
	f.t.Helper()
	var body *strings.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	} else {
		body = strings.NewReader("")
	}
	req := httptest.NewRequest(method, target, body)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: f.session})
	for i := 0; i+1 < len(pathValues); i += 2 {
		req.SetPathValue(pathValues[i], pathValues[i+1])
	}
	rec := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(h)).ServeHTTP(rec, req)
	return rec
}

func (f *surveyFixture) courseValue() []string {
	return []string{"id", strconv.FormatInt(f.courseID, 10)}
}

func (f *surveyFixture) createSurvey(name string) survey.Survey {
	f.t.Helper()
	s, err := f.surveys.CreateSurvey(context.Background(), f.courseID, f.professor.ID, survey.SurveyDraft{Name: name})
	if err != nil {
		f.t.Fatalf("CreateSurvey: %v", err)
	}
	return s
}

func TestTheSurveyListShowsTheCoursesActiveSurveysWithTheirBankSize(t *testing.T) {
	f := newSurveyFixture(t)
	withBank := f.createSurvey("Autoevaluación de conceptos")
	if _, err := f.surveys.AddQuestion(context.Background(), withBank.ID, survey.QuestionDraft{
		Kind: survey.KindSingle, Statement: "¿Sección?", Labels: []string{"A", "B"},
	}); err != nil {
		t.Fatalf("AddQuestion: %v", err)
	}
	f.createSurvey("Perfil inicial del grupo")
	archived := f.createSurvey("Archivada")
	if err := f.surveys.Archive(context.Background(), archived.ID); err != nil {
		t.Fatalf("Archive: %v", err)
	}

	rec := f.do(http.MethodGet, handler.CourseSurveysPathFor(f.courseID), f.handler.ListForCourse, nil, f.courseValue()...)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{"Autoevaluación de conceptos", "1 pregunta · sin pasadas aún",
		"Perfil inicial del grupo", "sin preguntas · sin pasadas aún", "Ver archivadas (1)",
		handler.CourseSurveysNewPathFor(f.courseID)} {
		if !strings.Contains(body, want) {
			t.Errorf("the list lacks %q", want)
		}
	}
	if strings.Contains(body, ">Archivada<") {
		t.Error("the active list shows an archived survey")
	}

	rec = f.do(http.MethodGet, handler.CourseSurveysPathFor(f.courseID)+"?archived=1", f.handler.ListForCourse, nil, f.courseValue()...)
	body = rec.Body.String()
	if !strings.Contains(body, "Archivada") || strings.Contains(body, "Perfil inicial del grupo") {
		t.Errorf("the archived list is wrong:\n%s", body)
	}
}

func TestTheSurveyListOfAnUnknownCourseIs404(t *testing.T) {
	f := newSurveyFixture(t)
	for _, id := range []string{strconv.FormatInt(f.courseID+9, 10), "abc", "0"} {
		rec := f.do(http.MethodGet, "/courses/"+id+"/surveys", f.handler.ListForCourse, nil, "id", id)
		if rec.Code != http.StatusNotFound {
			t.Errorf("course %q: status = %d, want 404", id, rec.Code)
		}
	}
}

func TestCreatingASurveyStoresItUnderTheCourseAsTheProfessor(t *testing.T) {
	f := newSurveyFixture(t)

	rec := f.do(http.MethodGet, handler.CourseSurveysNewPathFor(f.courseID), f.handler.New, nil, f.courseValue()...)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "CIT2006-03 2026-2") {
		t.Fatalf("the form: status = %d, body lacks the course", rec.Code)
	}

	rec = f.do(http.MethodPost, handler.CourseSurveysPathFor(f.courseID), f.handler.Create,
		url.Values{"name": {"  Autoevaluación  "}, "description": {"Es anónima."}}, f.courseValue()...)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(flashOf(t, rec), "Encuesta creada") {
		t.Errorf("flash = %q", flashOf(t, rec))
	}

	listed, err := f.surveys.SurveysForCourse(context.Background(), f.courseID)
	if err != nil || len(listed.Active) != 1 {
		t.Fatalf("stored surveys = %+v, %v", listed, err)
	}
	got := listed.Active[0].Survey
	if got.Name != "Autoevaluación" || got.Description != "Es anónima." || got.CreatedBy != f.professor.ID {
		t.Errorf("stored %+v", got)
	}
}

func TestARefusedSurveyIs422WithTheTypedValuesAndAFieldError(t *testing.T) {
	f := newSurveyFixture(t)
	rec := f.do(http.MethodPost, handler.CourseSurveysPathFor(f.courseID), f.handler.Create,
		url.Values{"name": {"   "}, "description": {"lo que escribí"}}, f.courseValue()...)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Escribe un nombre.") || !strings.Contains(body, "lo que escribí") {
		t.Errorf("the re-render lacks the error or the typed value:\n%s", body)
	}
	if listed, _ := f.surveys.SurveysForCourse(context.Background(), f.courseID); len(listed.Active) != 0 {
		t.Error("a refused survey was stored")
	}
}

// The course page is where a professor starts, so it links to the course's
// surveys.
func TestTheCoursePageLinksToItsSurveys(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)
	f.api.courses = canvasCourses()
	f.connect(t, session)
	courseID := f.addCourse(t, session, "44779")

	rec := f.getCourse(t, session, courseID)
	if want := `href="` + handler.CourseSurveysPathFor(courseID) + `"`; !strings.Contains(rec.Body.String(), want) {
		t.Errorf("the course page lacks %s", want)
	}
}
