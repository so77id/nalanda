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
	// Cancelled hides the question count, the steps and the actions: a
	// cancelled run is printed and read by nobody, and cancelling dropped
	// its snapshot (#310 review, COR-1), so the count would read zero.
	Cancelled  bool
	StateLabel string
	Banner     *JobBanner
	Steps      []RunStep
	PDFReady   bool
	PDFURL     string
	// The reading (issue #311): copies read, clean, waiting, and missing
	// (printed but never read).
	Read    int
	Clean   int
	Pending int
	Missing int
	// ReviewURL is the review queue, when a copy waits.
	ReviewURL string
	// CloseAction is "Cerrar pasada"'s target; CanClose says whether it is
	// offered, and CloseHint why not.
	CloseAction string
	CanClose    bool
	CloseHint   string
	// Open is whether the run still takes scans.
	Open         bool
	EditURL      string
	CanCancel    bool
	CancelAction string
	// ScansURL is screen 10 (issue #311).
	ScansURL string
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

// SurveyRunScansPage is what survey_run_scans.html renders: a run's scans
// (issue #311, screen 10).
type SurveyRunScansPage struct {
	Page
	RunTitle string
	RunURL   string
	Banner   *JobBanner
	// CanUpload is false on a run that is not open; the form is not drawn.
	CanUpload    bool
	UploadAction string
	MaxMB        int64
	Uploads      []UploadRow
	// The run's reading so far.
	Read    int
	Clean   int
	Pending int
	// ResetURL is "Borrar escaneos"' confirmation page; empty when there
	// is nothing to erase or the run is not open.
	ResetURL string
}

// UploadRow is one batch on disk.
type UploadRow struct {
	Name string
	Size string
}

// RenderSurveyRunScans writes screen 10.
func RenderSurveyRunScans(w http.ResponseWriter, page SurveyRunScansPage) error {
	return render(w, "survey_run_scans", http.StatusOK, page)
}

// SurveyCopyReviewPage is what survey_review.html renders: one copy's
// doubtful answers (issue #311, screen 11).
type SurveyCopyReviewPage struct {
	Page
	RunTitle string
	RunURL   string
	// Position is "Copia 2 de 4" among the copies that wait; empty when
	// this copy no longer waits.
	Position string
	Waiting  int
	PrevURL  string
	NextURL  string
	Pages    []string
	Action   string
	Items    []ReviewItemView
	// Editable is false on a run that is not open: the items are shown,
	// never decided.
	Editable bool
	// Undecided is whether any item of the copy still waits.
	Undecided bool
	Errors    []string
}

// ReviewItemView is one doubtful answer.
type ReviewItemView struct {
	ID          int64
	Heading     string // "Pregunta 7"
	Statement   string
	KindLabel   string
	Explanation string
	Multi       bool
	Options     []ReviewOption
	Comment     string
	// Decided is the recorded decision, empty while pending.
	Decided string
}

// ReviewOption is one alternative the professor may record.
type ReviewOption struct {
	Value    string
	Label    string
	Detected bool
	Checked  bool
}

// RenderSurveyCopyReview writes screen 11 with the caller's status.
func RenderSurveyCopyReview(w http.ResponseWriter, status int, page SurveyCopyReviewPage) error {
	return render(w, "survey_review", status, page)
}

// SurveyScansResetPage is "Borrar escaneos"' confirmation (issue #311).
type SurveyScansResetPage struct {
	Page
	RunTitle string
	RunURL   string
	BackURL  string
	Action   string
	// Phrase is what the professor types: "Pasada 3".
	Phrase   string
	Uploads  int
	Copies   int
	Decided  int
	Typed    string
	Mismatch string
}

// RenderSurveyScansReset writes the confirmation with the caller's status.
func RenderSurveyScansReset(w http.ResponseWriter, status int, page SurveyScansResetPage) error {
	return render(w, "survey_scans_reset_confirm", status, page)
}
