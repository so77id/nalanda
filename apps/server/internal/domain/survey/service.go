package survey

import (
	"context"
	"fmt"
	"time"
)

// Service is the survey bank's behaviour over a Store. A struct of
// dependencies, like controls.Service, with NewService refusing a set it
// cannot serve with.
type Service struct {
	Store Store
	// Generator compiles a run's sheet on the AMC worker (issue #310).
	Generator Generator
	// WorkDir is what the SERVER sees as the root of the worker's shared
	// /work volume — the controls' WorkDir, the same volume.
	WorkDir string
	// Now is the clock; a field rather than a package so the domain stays
	// free of infra (add-a-backend-endpoint.md §2).
	Now func() time.Time
}

// NewService returns the service, or panics at wiring time on a missing
// dependency — a nil store found inside a request would be a panic in a
// request path, which backend-code-style.md §Errors forbids.
func NewService(deps Service) *Service {
	switch {
	case deps.Store == nil:
		panic("survey.NewService: no store")
	case deps.Generator == nil:
		panic("survey.NewService: no generator")
	case deps.WorkDir == "":
		panic("survey.NewService: no work dir")
	case deps.Now == nil:
		panic("survey.NewService: no clock")
	}
	return &deps
}

// ListedSurvey is one survey and its bank's size, for a list page.
type ListedSurvey struct {
	Survey    Survey
	Questions int
}

// CourseSurveys is one course's surveys, split the way the list page shows
// them.
type CourseSurveys struct {
	Active   []ListedSurvey
	Archived []ListedSurvey
}

// CreateSurvey normalizes the draft and stores a new survey under the
// course, stamped with the service clock.
func (s *Service) CreateSurvey(ctx context.Context, courseID, createdBy int64, d SurveyDraft) (Survey, error) {
	d, err := d.Normalize()
	if err != nil {
		return Survey{}, err
	}
	now := s.Now()
	return s.Store.CreateSurvey(ctx, Survey{
		CourseID: courseID, Name: d.Name, Description: d.Description,
		CreatedBy: createdBy, CreatedAt: now, UpdatedAt: now,
	})
}

// Survey returns one survey.
func (s *Service) Survey(ctx context.Context, id int64) (Survey, error) {
	return s.Store.SurveyByID(ctx, id)
}

// SurveysForCourse returns the course's surveys, active and archived, each
// with its question count — two queries for the whole page.
func (s *Service) SurveysForCourse(ctx context.Context, courseID int64) (CourseSurveys, error) {
	all, err := s.Store.SurveysForCourse(ctx, courseID)
	if err != nil {
		return CourseSurveys{}, err
	}
	counts, err := s.Store.QuestionCounts(ctx, courseID)
	if err != nil {
		return CourseSurveys{}, err
	}
	var out CourseSurveys
	for _, one := range all {
		listed := ListedSurvey{Survey: one, Questions: counts[one.ID]}
		if one.Archived() {
			out.Archived = append(out.Archived, listed)
		} else {
			out.Active = append(out.Active, listed)
		}
	}
	return out, nil
}

// UpdateSurvey normalizes the draft and rewrites name and description.
func (s *Service) UpdateSurvey(ctx context.Context, id int64, d SurveyDraft) error {
	d, err := d.Normalize()
	if err != nil {
		return err
	}
	return s.Store.UpdateSurvey(ctx, id, d, s.Now())
}

// Archive hides the survey from its course's list. Idempotent.
func (s *Service) Archive(ctx context.Context, id int64) error {
	now := s.Now()
	return s.Store.SetArchived(ctx, id, &now, now)
}

// Restore brings an archived survey back. Idempotent.
func (s *Service) Restore(ctx context.Context, id int64) error {
	return s.Store.SetArchived(ctx, id, nil, s.Now())
}

// Questions returns the survey's bank, for a caller that already holds the
// survey. The store re-checks that the survey exists, so an unknown id is
// ErrSurveyNotFound rather than an empty bank.
func (s *Service) Questions(ctx context.Context, surveyID int64) ([]Question, error) {
	return s.Store.Questions(ctx, surveyID)
}

// Question returns one question of the survey, or ErrQuestionNotFound —
// including for a question that exists in another survey.
func (s *Service) Question(ctx context.Context, surveyID, questionID int64) (Question, error) {
	questions, err := s.Store.Questions(ctx, surveyID)
	if err != nil {
		return Question{}, err
	}
	for _, q := range questions {
		if q.ID == questionID {
			return q, nil
		}
	}
	return Question{}, fmt.Errorf("question %d of survey %d: %w", questionID, surveyID, ErrQuestionNotFound)
}

// AddQuestion normalizes the draft and appends it to the bank.
func (s *Service) AddQuestion(ctx context.Context, surveyID int64, d QuestionDraft) (Question, error) {
	d, err := d.Normalize()
	if err != nil {
		return Question{}, err
	}
	return s.Store.AddQuestion(ctx, surveyID, d, s.Now())
}

// UpdateQuestion normalizes the draft and rewrites the question in place.
func (s *Service) UpdateQuestion(ctx context.Context, surveyID, questionID int64, d QuestionDraft) error {
	d, err := d.Normalize()
	if err != nil {
		return err
	}
	return s.Store.UpdateQuestion(ctx, surveyID, questionID, d, s.Now())
}

// DeleteQuestion removes a question from the bank.
func (s *Service) DeleteQuestion(ctx context.Context, surveyID, questionID int64) error {
	return s.Store.DeleteQuestion(ctx, surveyID, questionID, s.Now())
}

// MoveQuestion moves a question one step up (-1) or down (+1).
func (s *Service) MoveQuestion(ctx context.Context, surveyID, questionID int64, delta int) error {
	if delta != -1 && delta != 1 {
		return fmt.Errorf("survey.MoveQuestion: delta %d, want -1 or +1", delta)
	}
	return s.Store.MoveQuestion(ctx, surveyID, questionID, delta, s.Now())
}

// Section is a run of consecutive questions sharing one section label.
type Section struct {
	// Label is "" for questions with no section.
	Label     string
	Questions []Question
}

// Sections groups a bank into runs of consecutive questions that share a
// label. Consecutive, never merged: the sheet prints in bank order, so a
// label that reappears later starts a new run rather than pulling the
// later question back under the earlier heading.
func Sections(questions []Question) []Section {
	var out []Section
	for _, q := range questions {
		if n := len(out); n > 0 && out[n-1].Label == q.Section {
			out[n-1].Questions = append(out[n-1].Questions, q)
			continue
		}
		out = append(out, Section{Label: q.Section, Questions: []Question{q}})
	}
	return out
}
