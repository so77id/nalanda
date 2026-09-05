package roster

import (
	"context"
	"fmt"
	"sort"
)

// CoursePick is one row of the picker: a Canvas course, and whether this
// server already has it.
type CoursePick struct {
	CanvasID string
	Name     string
	Code     string
	Term     string
	// Added is true when a `course` row already carries this CanvasID. The
	// picker shows those as taken rather than offering them twice — the
	// screen half of the schema's UNIQUE.
	Added bool
	// CourseID is the Nalanda id, set only when Added.
	CourseID int64
}

// CourseChoices is what the picker renders: the courses of the most recent
// term, and nothing else.
//
// `allCourses` returns every course the professor has ever been enrolled in
// — 16 for the one measured in S4, back to 2020 — and the stated need is the
// course being taught now. An earlier revision kept the rest behind a
// disclosure; it was dropped because an old course is not something to make
// reachable by one click, it is something to make unreachable: importing a
// finished course writes a roster nobody will use, and its students are all
// `completed`, which is exactly the state that turned out to be dangerous
// (ADR-0069 §Decision 4).
//
// A professor teaching two sections in one term sees both — the grouping key
// is the term NAME, not the course.
type CourseChoices struct {
	// CurrentTerm is the term Current belongs to, for the heading. Empty
	// when no course carries a term start at all — see split.
	CurrentTerm string
	Current     []CoursePick
}

// Empty reports whether the picker has nothing to offer.
func (c CourseChoices) Empty() bool { return len(c.Current) == 0 }

// Service is the policy over the roster.
type Service struct {
	Store  Store
	Source CourseSource
}

// NewService returns the service. Both ports are required: a nil one is a
// wiring mistake, and wiring time is the one place §Errors allows a panic.
func NewService(store Store, source CourseSource) *Service {
	switch {
	case store == nil:
		panic("roster.NewService: no store")
	case source == nil:
		panic("roster.NewService: no course source")
	}
	return &Service{Store: store, Source: source}
}

// Choices returns what the picker should render: the professor's Canvas
// courses, split into the most recent term and the rest, each marked with
// whether this server already has it.
func (s *Service) Choices(ctx context.Context, userID int64) (CourseChoices, error) {
	fromCanvas, err := s.Source.CoursesFor(ctx, userID)
	if err != nil {
		// Passed through with its sentinel intact: the caller renders a
		// different thing for "no token yet" than for "Canvas is down".
		return CourseChoices{}, err
	}
	stored, err := s.Store.ListCourses(ctx)
	if err != nil {
		return CourseChoices{}, fmt.Errorf("roster: list the stored courses: %w", err)
	}

	added := make(map[string]Course, len(stored))
	for _, c := range stored {
		added[c.CanvasCourseID] = c
	}

	return split(fromCanvas, added), nil
}

// split returns the courses of the most recent term.
//
// "Most recent" is decided by the term's start, descending, with a course
// whose term has no start sorting LAST: Canvas's default term carries a null
// start (2 of the 16 courses measured in S4), and treating an absent date as
// the beginning of time would put "Inducción a la docencia" at the top,
// above the course the professor actually came for.
//
// The grouping key is the TERM NAME, so every course of the current
// semester travels together.
//
// FALLBACK: when NO course carries a term start, there is no "most recent"
// to narrow to, and every course is offered. Otherwise a professor whose
// courses all sit in Canvas's default term would meet an empty picker with
// nothing to click and no way to tell why.
func split(sources []SourceCourse, added map[string]Course) CourseChoices {
	ordered := make([]SourceCourse, len(sources))
	copy(ordered, sources)

	sort.SliceStable(ordered, func(i, j int) bool {
		a, b := ordered[i], ordered[j]
		if (a.TermStart == "") != (b.TermStart == "") {
			return b.TermStart == ""
		}
		if a.TermStart != b.TermStart {
			return a.TermStart > b.TermStart
		}
		return a.Code < b.Code
	})

	pickOf := func(c SourceCourse) CoursePick {
		pick := CoursePick{CanvasID: c.CanvasID, Name: c.Name, Code: c.Code, Term: c.Term}
		if stored, ok := added[c.CanvasID]; ok {
			pick.Added = true
			pick.CourseID = stored.ID
		}
		return pick
	}

	choices := CourseChoices{}
	if len(ordered) == 0 {
		return choices
	}
	if ordered[0].TermStart == "" {
		for _, c := range ordered {
			choices.Current = append(choices.Current, pickOf(c))
		}
		return choices
	}

	choices.CurrentTerm = ordered[0].Term
	for _, c := range ordered {
		if c.Term == choices.CurrentTerm {
			choices.Current = append(choices.Current, pickOf(c))
		}
	}
	return choices
}

// AddCourse creates the `course` row for one of the professor's Canvas
// courses.
//
// Every field comes from Canvas, never from the request: the POST carries
// only which course, and this method looks it up in the professor's own
// Canvas listing. A form that posted the name and the code would let a
// hand-typed request invent a course, and would let a typo in a hidden
// field produce a course that imports a roster belonging to someone else.
func (s *Service) AddCourse(ctx context.Context, userID int64, canvasCourseID string) (Course, error) {
	fromCanvas, err := s.Source.CoursesFor(ctx, userID)
	if err != nil {
		return Course{}, err
	}

	for _, c := range fromCanvas {
		if c.CanvasID != canvasCourseID {
			continue
		}
		return s.Store.CreateCourse(ctx, Course{
			Name:           c.Name,
			Code:           c.Code,
			Term:           c.Term,
			CanvasCourseID: c.CanvasID,
		})
	}
	return Course{}, fmt.Errorf("%w: %s", ErrNotInCanvas, canvasCourseID)
}

// Import fetches the course's roster from Canvas and applies it.
//
// Upsert, never replace: a student Canvas still lists is updated in place,
// one it no longer lists is stamped withdrawn rather than deleted. Deleting
// would take the enrolment out from under grades that already exist — WP-2
// matches a reading's RUT to a person, and a student who dropped the course
// still sat the controls they sat.
//
// The whole roster is applied atomically by the store. A half-applied
// import looks exactly like a class where some students vanished, and the
// professor would have no way to tell which half arrived.
func (s *Service) Import(ctx context.Context, userID, courseID int64) (ImportResult, error) {
	course, err := s.Store.CourseByID(ctx, courseID)
	if err != nil {
		return ImportResult{}, err
	}

	students, err := s.Source.RosterFor(ctx, userID, course.CanvasCourseID)
	if err != nil {
		// Passed through with its sentinel: the handler says something
		// different for a revoked token than for an outage.
		return ImportResult{}, err
	}

	result, err := s.Store.SaveRoster(ctx, courseID, students)
	if err != nil {
		return ImportResult{}, err
	}
	return result, nil
}

// Enrollments returns one course and the people on it.
func (s *Service) Enrollments(ctx context.Context, courseID int64) (Course, []Enrollment, error) {
	course, err := s.Store.CourseByID(ctx, courseID)
	if err != nil {
		return Course{}, nil, err
	}
	enrollments, err := s.Store.ListEnrollments(ctx, courseID)
	if err != nil {
		return Course{}, nil, err
	}
	// The ordering is this layer's rule, applied here rather than left to
	// the store to remember (#271 review, ARQ-9).
	SortEnrollments(enrollments)
	return course, enrollments, nil
}

// CoursesWithCounts is what the list screen renders: every course, each
// with its tally and whether it has a roster at all.
//
// Two queries total, whatever the number of courses. The screen used to run
// one enrolment query per course THROUGH this service's store field, which
// was both a boundary the handler package breaks nowhere else and a read of
// every student row to produce a number (#271 review, ARQ-1).
func (s *Service) CoursesWithCounts(ctx context.Context) ([]CourseWithCounts, error) {
	courses, err := s.Store.ListCourses(ctx)
	if err != nil {
		return nil, fmt.Errorf("roster: list the courses: %w", err)
	}
	counts, err := s.Store.EnrollmentCounts(ctx)
	if err != nil {
		return nil, fmt.Errorf("roster: count the enrolments: %w", err)
	}

	out := make([]CourseWithCounts, 0, len(courses))
	for _, course := range courses {
		tally, hasRoster := counts[course.ID]
		out = append(out, CourseWithCounts{Course: course, Counts: tally, HasRoster: hasRoster})
	}
	return out, nil
}
