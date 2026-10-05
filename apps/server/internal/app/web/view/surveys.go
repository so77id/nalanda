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

// SurveyDetailPage is what survey_detail.html renders: one survey's bank
// and its runs (screen 3).
type SurveyDetailPage struct {
	Page
	Course        ListedCourse
	ListURL       string
	Name          string
	Description   string
	Archived      bool
	EditURL       string
	ArchiveAction string
	RestoreAction string
	NewQuestion   string
	NewRunURL     string
	Runs          []ListedRun
	// Locked is true once a run that is not cancelled exists: the bank's
	// existing questions can no longer be edited, deleted or moved.
	Locked bool
	// QuestionCount is the bank's size; Sections is the bank grouped by
	// consecutive section label, in bank order.
	QuestionCount int
	Sections      []SurveySection
}

// SurveySection is one run of consecutive questions under one label; an
// empty Label renders no heading.
type SurveySection struct {
	Label     string
	Questions []SurveyQuestionRow
}

// SurveyQuestionRow is one question of the bank, pre-formatted, with the
// actions its row offers.
type SurveyQuestionRow struct {
	Number       int
	Statement    string
	KindLabel    string
	Alternatives string
	IsContext    bool
	EditURL      string
	PreviewURL   string
	DeleteAction string
	MoveAction   string
	// First and Last hide the ↑ / ↓ that would do nothing.
	First bool
	Last  bool
}

// SurveyQuestionFormPage is what survey_question_form.html renders, for a
// new question and for editing one (screens 4 and 4b).
type SurveyQuestionFormPage struct {
	Page
	SurveyName string
	Heading    string
	Action     string
	Submit     string
	CancelURL  string
	// PreviewURL is set on an edit: a new question has nothing stored to
	// preview yet.
	PreviewURL    string
	KindLinks     []KindLink
	PointOptions  []int
	KnownSections []string
	Values        QuestionFormValues
	Errors        map[string]string
	Notice        string
}

// KindLink is one entry of the kind selector: a link that re-renders the
// form for that kind.
type KindLink struct {
	Label   string
	URL     string
	Current bool
}

// QuestionFormValues is what the form shows: what the professor typed on a
// refusal, the stored question on an edit, the defaults on a new one.
// Alternatives always holds the form's ten rows and ScaleLabels its seven,
// blank where unused.
type QuestionFormValues struct {
	Kind         string
	Statement    string
	Section      string
	IsContext    bool
	Alternatives []string
	ScaleLabels  []string
	Points       int
	MinMarks     string
	MaxMarks     string
}

// SurveyRunFormPage is what survey_run_form.html renders: a new run
// (screen 8) or, without the copies, a run's edit form.
type SurveyRunFormPage struct {
	Page
	SurveyName    string
	Heading       string
	Action        string
	Submit        string
	CancelURL     string
	ShowCopies    bool
	QuestionCount int
	Values        RunFormValues
	Errors        map[string]string
	Notice        string
}

// SurveyRunPage is what survey_run.html renders: one run's dashboard
// (screen 9).
type SurveyRunPage struct {
	Page
	SurveyName    string
	SurveyURL     string
	Title         string
	AppliedOn     string
	Copies        int
	QuestionCount int
	// ShowQuestionCount is false for a cancelled run: cancelling drops its
	// snapshot (#310 review, COR-1), so the count would read zero.
	ShowQuestionCount bool
	StateLabel        string
	Banner            *JobBanner
	Steps             []RunStep
	PDFReady          bool
	PDFURL            string
	ReadLabel         string
	ReviewLabel       string
	EditURL           string
	CanCancel         bool
	CancelAction      string
}

// RunStep is one stage of a run's stepper.
type RunStep struct {
	Label  string
	Status string
	Done   bool
}

// ListedRun is one run on a survey's page.
type ListedRun struct {
	Label string
	Meta  string
	URL   string
	// Cancelled runs are listed struck through, for the record.
	Cancelled bool
}

// RunFormValues is what the run form shows.
type RunFormValues struct {
	Name      string
	AppliedOn string
	Copies    string
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

// RenderSurveyDetail writes screen 3.
func RenderSurveyDetail(w http.ResponseWriter, page SurveyDetailPage) error {
	return render(w, "survey_detail", http.StatusOK, page)
}

// RenderSurveyQuestionForm writes the question form with the caller's
// status.
func RenderSurveyQuestionForm(w http.ResponseWriter, status int, page SurveyQuestionFormPage) error {
	return render(w, "survey_question_form", status, page)
}

// SurveyQuestionPreviewPage is what survey_question_preview.html renders:
// an HTML approximation of one printed question (screen 5).
type SurveyQuestionPreviewPage struct {
	Page
	SurveyName string
	BackURL    string
	EditURL    string
	Number     int
	Statement  string
	// Horizontal lays a scale's points out in a row, as the sheet does.
	Horizontal bool
	Options    []PreviewOption
	// Guide is a multi-select question's printed guidance, if any.
	Guide string
}

// PreviewOption is one bubble: its letter (or a scale point's number) and
// its label.
type PreviewOption struct {
	Letter string
	Label  string
}

// RenderSurveyQuestionPreview writes screen 5.
func RenderSurveyQuestionPreview(w http.ResponseWriter, page SurveyQuestionPreviewPage) error {
	return render(w, "survey_question_preview", http.StatusOK, page)
}

// RenderSurveyRunForm writes the run form with the caller's status.
func RenderSurveyRunForm(w http.ResponseWriter, status int, page SurveyRunFormPage) error {
	return render(w, "survey_run_form", status, page)
}

// RenderSurveyRun writes screen 9.
func RenderSurveyRun(w http.ResponseWriter, page SurveyRunPage) error {
	return render(w, "survey_run", http.StatusOK, page)
}
