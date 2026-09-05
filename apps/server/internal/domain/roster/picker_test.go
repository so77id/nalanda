package roster_test

import (
	"context"
	"errors"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
)

// The picker's cases run against the shapes the S4 spike measured on the
// real UDP Canvas: 16 courses back to 2020, two of them in Canvas's default
// term with a null start (ADR-0069).

const professor = int64(7)

type fakeSource struct {
	courses  []roster.SourceCourse
	students []roster.SourceStudent
	err      error
	calls    int
	// seenCanvasCourse records which Canvas course RosterFor was asked
	// about, so a case can prove the id came from the STORED course rather
	// than from the request.
	seenCanvasCourse string
}

func (f *fakeSource) CoursesFor(context.Context, int64) ([]roster.SourceCourse, error) {
	f.calls++
	return f.courses, f.err
}

func (f *fakeSource) RosterFor(_ context.Context, _ int64, canvasCourseID string) ([]roster.SourceStudent, error) {
	f.calls++
	f.seenCanvasCourse = canvasCourseID
	return f.students, f.err
}

type memStore struct {
	rows    []roster.Course
	nextID  int64
	listErr error
	// saved records what SaveRoster was handed, per course.
	saved     map[int64][]roster.SourceStudent
	saveErr   error
	saveCalls int
}

func (m *memStore) CreateCourse(_ context.Context, c roster.Course) (roster.Course, error) {
	for _, existing := range m.rows {
		if existing.CanvasCourseID == c.CanvasCourseID {
			return roster.Course{}, roster.ErrAlreadyAdded
		}
	}
	m.nextID++
	c.ID = m.nextID
	m.rows = append(m.rows, c)
	return c, nil
}

func (m *memStore) ListCourses(context.Context) ([]roster.Course, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	return m.rows, nil
}

func (m *memStore) SaveRoster(_ context.Context, courseID int64, students []roster.SourceStudent) (roster.ImportResult, error) {
	m.saveCalls++
	if m.saveErr != nil {
		return roster.ImportResult{}, m.saveErr
	}
	if m.saved == nil {
		m.saved = map[int64][]roster.SourceStudent{}
	}
	m.saved[courseID] = students

	result := roster.ImportResult{Added: len(students)}
	for _, st := range students {
		if st.RUT == "" {
			result.WithoutRUT++
		}
	}
	return result, nil
}

func (m *memStore) ListEnrollments(context.Context, int64) ([]roster.Enrollment, error) {
	return nil, nil
}

func (m *memStore) CourseByID(_ context.Context, id int64) (roster.Course, error) {
	for _, c := range m.rows {
		if c.ID == id {
			return c, nil
		}
	}
	return roster.Course{}, roster.ErrCourseNotFound
}

// canvasCourses is the professor's real listing, trimmed: two courses in the
// current term, one older, and one in Canvas's default term with no start.
func canvasCourses() []roster.SourceCourse {
	return []roster.SourceCourse{
		{CanvasID: "23334", Name: "ESTRUCTURAS DE DATOS Y ALGORITMOS", Code: "CIT2006_CA01",
			Term: "2023-2", TermStart: "2023-07-19T00:00:00-04:00"},
		{CanvasID: "47743", Name: "Inducción a la docencia", Code: "Segundo semestre 2026",
			Term: "Período predeterminado", TermStart: ""},
		{CanvasID: "44779", Name: "ESTRUCTURAS DE DATOS Y ALGORITMOS", Code: "CIT2006_CA01",
			Term: "2026-2", TermStart: "2026-07-14T00:00:00-04:00"},
		{CanvasID: "44780", Name: "ESTRUCTURAS DE DATOS Y ALGORITMOS", Code: "CIT2006_CA02",
			Term: "2026-2", TermStart: "2026-07-14T00:00:00-04:00"},
	}
}

func TestChoicesPutsTheCurrentTermFirstAndTheRestBehind(t *testing.T) {
	svc := roster.NewService(&memStore{}, &fakeSource{courses: canvasCourses()})

	choices, err := svc.Choices(context.Background(), professor)
	if err != nil {
		t.Fatalf("Choices: %v", err)
	}

	if choices.CurrentTerm != "2026-2" {
		t.Errorf("CurrentTerm = %q, want 2026-2", choices.CurrentTerm)
	}
	// BOTH sections of the current semester, so a professor teaching two
	// does not have to open the disclosure to find the second.
	if len(choices.Current) != 2 {
		t.Fatalf("Current has %d courses, want the 2 sections of 2026-2: %+v", len(choices.Current), choices.Current)
	}
	if choices.Current[0].Code != "CIT2006_CA01" || choices.Current[1].Code != "CIT2006_CA02" {
		t.Errorf("Current = %q, %q; want the two sections in code order",
			choices.Current[0].Code, choices.Current[1].Code)
	}
	if len(choices.Older) != 2 {
		t.Fatalf("Older has %d courses, want 2: %+v", len(choices.Older), choices.Older)
	}
	// The 2023 course before the one with no term start at all: an absent
	// date sorts last, never first.
	if choices.Older[0].CanvasID != "23334" || choices.Older[1].CanvasID != "47743" {
		t.Errorf("Older = %q, %q; want the 2023 course before the one with no term start",
			choices.Older[0].CanvasID, choices.Older[1].CanvasID)
	}
}

// The failure this ordering exists to prevent: Canvas's default term
// carries a null start, and treating that as the beginning of time would
// put "Inducción a la docencia" above the course the professor wants.
func TestACourseWithNoTermStartNeverBecomesTheCurrentTerm(t *testing.T) {
	svc := roster.NewService(&memStore{}, &fakeSource{courses: canvasCourses()})

	choices, err := svc.Choices(context.Background(), professor)
	if err != nil {
		t.Fatalf("Choices: %v", err)
	}
	for _, c := range choices.Current {
		if c.CanvasID == "47743" {
			t.Error("the default-term course was put in the current term")
		}
	}
}

// When nothing has a term start, there is no "current" to speak of and
// everything is reachable through the disclosure rather than lost.
func TestWithNoTermStartsAtAllEverythingIsOlder(t *testing.T) {
	svc := roster.NewService(&memStore{}, &fakeSource{courses: []roster.SourceCourse{
		{CanvasID: "1", Code: "A", Term: "Período predeterminado"},
		{CanvasID: "2", Code: "B", Term: "Período predeterminado"},
	}})

	choices, err := svc.Choices(context.Background(), professor)
	if err != nil {
		t.Fatalf("Choices: %v", err)
	}
	if len(choices.Current) != 0 || choices.CurrentTerm != "" {
		t.Errorf("Current = %+v with term %q, want empty", choices.Current, choices.CurrentTerm)
	}
	if len(choices.Older) != 2 {
		t.Errorf("Older has %d, want both courses reachable", len(choices.Older))
	}
	if choices.Empty() {
		t.Error("Empty() is true while two courses are listed")
	}
}

func TestChoicesMarksACourseThatIsAlreadyAdded(t *testing.T) {
	store := &memStore{}
	svc := roster.NewService(store, &fakeSource{courses: canvasCourses()})

	added, err := svc.AddCourse(context.Background(), professor, "44779")
	if err != nil {
		t.Fatalf("AddCourse: %v", err)
	}

	choices, err := svc.Choices(context.Background(), professor)
	if err != nil {
		t.Fatalf("Choices: %v", err)
	}
	for _, c := range choices.Current {
		if c.CanvasID != "44779" {
			if c.Added {
				t.Errorf("%s is marked as added and was not", c.CanvasID)
			}
			continue
		}
		if !c.Added {
			t.Error("the added course is not marked as added")
		}
		if c.CourseID != added.ID {
			t.Errorf("CourseID = %d, want the stored id %d", c.CourseID, added.ID)
		}
	}
}

// Every field comes from Canvas. A form that posted the name and the code
// would let a hand-typed request invent a course — or, worse, name one
// course while carrying another's Canvas id and import a roster that
// belongs to somebody else.
func TestAddCourseTakesEveryFieldFromCanvas(t *testing.T) {
	store := &memStore{}
	svc := roster.NewService(store, &fakeSource{courses: canvasCourses()})

	course, err := svc.AddCourse(context.Background(), professor, "44779")
	if err != nil {
		t.Fatalf("AddCourse: %v", err)
	}
	if course.Name != "ESTRUCTURAS DE DATOS Y ALGORITMOS" || course.Code != "CIT2006_CA01" ||
		course.Term != "2026-2" || course.CanvasCourseID != "44779" {
		t.Errorf("stored %+v, want the fields Canvas reported", course)
	}
	if course.ID == 0 {
		t.Error("the stored course has no id")
	}
}

// A Canvas id the professor's own Canvas does not list is refused, not
// stored. Reached by a hand-typed POST, or by a course that disappeared
// between the render and the click.
func TestAddCourseRefusesACourseCanvasDoesNotList(t *testing.T) {
	store := &memStore{}
	svc := roster.NewService(store, &fakeSource{courses: canvasCourses()})

	_, err := svc.AddCourse(context.Background(), professor, "999999")
	if !errors.Is(err, roster.ErrNotInCanvas) {
		t.Errorf("AddCourse returned %v, want ErrNotInCanvas", err)
	}
	if len(store.rows) != 0 {
		t.Errorf("a course Canvas does not list was stored anyway: %+v", store.rows)
	}
}

func TestAddingTheSameCourseTwiceIsRefused(t *testing.T) {
	store := &memStore{}
	svc := roster.NewService(store, &fakeSource{courses: canvasCourses()})

	if _, err := svc.AddCourse(context.Background(), professor, "44779"); err != nil {
		t.Fatalf("AddCourse (first): %v", err)
	}
	_, err := svc.AddCourse(context.Background(), professor, "44779")
	if !errors.Is(err, roster.ErrAlreadyAdded) {
		t.Errorf("AddCourse (second) returned %v, want ErrAlreadyAdded", err)
	}
	if len(store.rows) != 1 {
		t.Errorf("the store holds %d rows after a duplicate add, want 1", len(store.rows))
	}
}

// The source's failure is passed through with its sentinel intact, because
// the caller renders a different thing for "no token yet" than for "Canvas
// is down". Flattening it here would lose that distinction one layer below
// the screen that needs it.
func TestChoicesAndAddCoursePassTheSourceFailureThrough(t *testing.T) {
	boom := errors.New("canvas: no token stored for this professor")
	store := &memStore{}
	svc := roster.NewService(store, &fakeSource{err: boom})

	if _, err := svc.Choices(context.Background(), professor); !errors.Is(err, boom) {
		t.Errorf("Choices returned %v, want the source's own error", err)
	}
	if _, err := svc.AddCourse(context.Background(), professor, "44779"); !errors.Is(err, boom) {
		t.Errorf("AddCourse returned %v, want the source's own error", err)
	}
	if len(store.rows) != 0 {
		t.Error("a course was stored despite the source failing")
	}
}

func TestChoicesOnAProfessorWithNoCanvasCoursesIsEmpty(t *testing.T) {
	svc := roster.NewService(&memStore{}, &fakeSource{})

	choices, err := svc.Choices(context.Background(), professor)
	if err != nil {
		t.Fatalf("Choices: %v", err)
	}
	if !choices.Empty() {
		t.Errorf("Empty() is false for %+v", choices)
	}
}

// --- Import (S6) ---------------------------------------------------------

// The Canvas course id the import asks about comes from the STORED course,
// never from the request. A handler that passed one through would let a
// hand-typed POST point a course at somebody else's roster.
func TestImportAsksCanvasAboutTheStoredCoursesCanvasID(t *testing.T) {
	store := &memStore{}
	source := &fakeSource{
		courses:  canvasCourses(),
		students: []roster.SourceStudent{{CanvasUserID: "900001", RUT: "11222333", RUTDV: "5"}},
	}
	svc := roster.NewService(store, source)

	course, err := svc.AddCourse(context.Background(), professor, "44779")
	if err != nil {
		t.Fatalf("AddCourse: %v", err)
	}

	result, err := svc.Import(context.Background(), professor, course.ID)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if source.seenCanvasCourse != "44779" {
		t.Errorf("Canvas was asked about %q, want the stored course's Canvas id", source.seenCanvasCourse)
	}
	if result.Added != 1 {
		t.Errorf("result = %+v, want the one student", result)
	}
	if len(store.saved[course.ID]) != 1 {
		t.Errorf("the store was handed %d students", len(store.saved[course.ID]))
	}
}

func TestImportRefusesACourseThisServerDoesNotHave(t *testing.T) {
	store := &memStore{}
	svc := roster.NewService(store, &fakeSource{courses: canvasCourses()})

	_, err := svc.Import(context.Background(), professor, 4242)
	if !errors.Is(err, roster.ErrCourseNotFound) {
		t.Errorf("Import returned %v, want ErrCourseNotFound", err)
	}
	if store.saveCalls != 0 {
		t.Error("the store was written to for a course that does not exist")
	}
}

// Canvas failing means nothing is saved. Passing an empty roster to the
// store on an outage would withdraw the entire class.
func TestImportSavesNothingWhenCanvasFails(t *testing.T) {
	boom := errors.New("canvas: Canvas could not be reached")
	store := &memStore{}
	source := &fakeSource{courses: canvasCourses()}
	svc := roster.NewService(store, source)

	course, err := svc.AddCourse(context.Background(), professor, "44779")
	if err != nil {
		t.Fatalf("AddCourse: %v", err)
	}

	source.err = boom
	if _, err := svc.Import(context.Background(), professor, course.ID); !errors.Is(err, boom) {
		t.Errorf("Import returned %v, want the source's own error", err)
	}
	if store.saveCalls != 0 {
		t.Error("the store was written to despite Canvas failing; an empty roster would withdraw the whole class")
	}
}
