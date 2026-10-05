package view

import "net/http"

// The survey screens (epic #308, ADR-0078). In a file of their own rather
// than appended to view.go: the subsystem is a sibling of the controls, and
// its pages are easier to find — and, one day, to move — together.

// SurveysListPage is what surveys_list.html renders: one course's surveys
// (screen 1 of the mockups). Row values are pre-formatted by the handler.
type SurveysListPage struct {
	Page
	Course  ListedCourse
	NewURL  string
	Surveys []ListedSurveyRow
	// ShowingArchived switches the page to the archived list; ToggleURL
	// is the link to the other one.
	ShowingArchived bool
	ArchivedCount   int
	ToggleURL       string
}

// ListedSurveyRow is one survey on the course's list.
type ListedSurveyRow struct {
	Name    string
	URL     string
	Summary string
}

// SurveyFormPage is what surveys_form.html renders, for both "Nueva
// encuesta" (screen 2) and editing one — the same-template convention of
// backend-code-style.md §Form / validation / errors.
type SurveyFormPage struct {
	Page
	Heading     string
	Action      string
	Submit      string
	CancelURL   string
	CourseLabel string
	Values      SurveyFormValues
	Errors      map[string]string
	// Notice is a form-wide message ("no se pudo leer el formulario").
	Notice string
}

// SurveyFormValues is what the professor typed, rendered back on refusal.
type SurveyFormValues struct {
	Name        string
	Description string
}

// RenderSurveysList writes screen 1.
func RenderSurveysList(w http.ResponseWriter, page SurveysListPage) error {
	return render(w, "surveys_list", http.StatusOK, page)
}

// RenderSurveyForm writes the survey form with the caller's status — 200 on
// a GET, 422 on a refused submission.
func RenderSurveyForm(w http.ResponseWriter, status int, page SurveyFormPage) error {
	return render(w, "surveys_form", status, page)
}
