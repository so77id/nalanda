package handler_test

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// Screen 3 of epic #308 (issue #309 S5): one survey's page, its edit form,
// and archive / restore.

func (f *surveyFixture) surveyValue(s survey.Survey) []string {
	return []string{"id", strconv.FormatInt(s.ID, 10)}
}

func (f *surveyFixture) addQuestion(s survey.Survey, d survey.QuestionDraft) survey.Question {
	f.t.Helper()
	q, err := f.surveys.AddQuestion(context.Background(), s.ID, d)
	if err != nil {
		f.t.Fatalf("AddQuestion: %v", err)
	}
	return q
}

func TestTheSurveyPageShowsTheBankGroupedBySection(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Autoevaluación de conceptos")
	f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿En qué sección estás?",
		Section: "Contexto", IsContext: true, Labels: []string{"A", "B", "C"}})
	f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindScale, Statement: "¿Qué tan clara te resultó la definición de TDA?",
		Section: "Confianza en los temas", Labels: survey.DefaultScaleLabels(5)})
	two := 2
	f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindMulti, Statement: "¿Qué estructuras te costó más entender?",
		Section: "Confianza en los temas", Labels: []string{"Heap", "BST"}, MaxMarks: &two})

	rec := f.do(http.MethodGet, handler.SurveyPathFor(s.ID), f.handler.Detail, nil, f.surveyValue(s)...)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{
		"Autoevaluación de conceptos", "3 preguntas",
		"<h3>Contexto</h3>", "Opción única · A · B · C", "(contexto)",
		"<h3>Confianza en los temas</h3>", "Escala 1-5",
		"Selección múltiple · Heap · BST · marca hasta 2",
		"Ninguna pasada aún.", handler.CourseSurveysPathFor(f.courseID),
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the survey page lacks %q", want)
		}
	}
	// One heading per run of a section, not one per question.
	if n := strings.Count(body, "<h3>Confianza en los temas</h3>"); n != 1 {
		t.Errorf("the section heading appears %d times, want 1", n)
	}
}

func TestAnUnknownSurveyIs404(t *testing.T) {
	f := newSurveyFixture(t)
	for _, id := range []string{"999", "x", "-1"} {
		rec := f.do(http.MethodGet, "/surveys/"+id, f.handler.Detail, nil, "id", id)
		if rec.Code != http.StatusNotFound {
			t.Errorf("survey %q: status = %d, want 404", id, rec.Code)
		}
	}
}

func TestCreatingASurveyLandsOnItsPage(t *testing.T) {
	f := newSurveyFixture(t)
	rec := f.do(http.MethodPost, handler.CourseSurveysPathFor(f.courseID), f.handler.Create,
		url.Values{"name": {"Nueva"}}, f.courseValue()...)
	listed, _ := f.surveys.SurveysForCourse(context.Background(), f.courseID)
	if len(listed.Active) != 1 {
		t.Fatalf("stored %d surveys", len(listed.Active))
	}
	if loc := rec.Header().Get("Location"); loc != handler.SurveyPathFor(listed.Active[0].Survey.ID) {
		t.Errorf("Location = %q, want the new survey's page", loc)
	}
}

func TestEditingASurveyRewritesItOrRefusesWith422(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Antes")
	editPath := handler.SurveyPathFor(s.ID) + "/edit"

	rec := f.do(http.MethodGet, editPath, f.handler.Edit, nil, f.surveyValue(s)...)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `value="Antes"`) {
		t.Fatalf("the edit form: status = %d, not pre-filled", rec.Code)
	}

	rec = f.do(http.MethodPost, editPath, f.handler.Update, url.Values{"name": {""}, "description": {"nueva"}}, f.surveyValue(s)...)
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "Escribe un nombre.") {
		t.Errorf("a blank name: status = %d, want 422 with the field error", rec.Code)
	}
	if got, _ := f.surveys.Survey(context.Background(), s.ID); got.Name != "Antes" {
		t.Errorf("a refused edit changed the name to %q", got.Name)
	}

	rec = f.do(http.MethodPost, editPath, f.handler.Update, url.Values{"name": {"Después"}, "description": {"Impresa"}}, f.surveyValue(s)...)
	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != handler.SurveyPathFor(s.ID) {
		t.Fatalf("status = %d, Location = %q", rec.Code, rec.Header().Get("Location"))
	}
	if got, _ := f.surveys.Survey(context.Background(), s.ID); got.Name != "Después" || got.Description != "Impresa" {
		t.Errorf("stored %+v", got)
	}
}

func TestArchivingLandsOnTheListAndRestoringOnTheSurvey(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Para archivar")

	rec := f.do(http.MethodPost, handler.SurveyPathFor(s.ID)+"/archive", f.handler.Archive, url.Values{}, f.surveyValue(s)...)
	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != handler.CourseSurveysPathFor(f.courseID) {
		t.Fatalf("archive: status = %d, Location = %q", rec.Code, rec.Header().Get("Location"))
	}
	if !strings.Contains(flashOf(t, rec), "Ver archivadas") {
		t.Errorf("the archive flash does not say where it went: %q", flashOf(t, rec))
	}
	if got, _ := f.surveys.Survey(context.Background(), s.ID); !got.Archived() {
		t.Fatal("the survey is not archived")
	}
	page := f.do(http.MethodGet, handler.SurveyPathFor(s.ID), f.handler.Detail, nil, f.surveyValue(s)...)
	if body := page.Body.String(); !strings.Contains(body, "está archivada") || !strings.Contains(body, "Restaurar") {
		t.Error("an archived survey's page does not say so or offer Restaurar")
	}

	rec = f.do(http.MethodPost, handler.SurveyPathFor(s.ID)+"/restore", f.handler.Restore, url.Values{}, f.surveyValue(s)...)
	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != handler.SurveyPathFor(s.ID) {
		t.Fatalf("restore: status = %d, Location = %q", rec.Code, rec.Header().Get("Location"))
	}
	if got, _ := f.surveys.Survey(context.Background(), s.ID); got.Archived() {
		t.Error("the survey is still archived")
	}
}
