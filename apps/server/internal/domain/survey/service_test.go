package survey_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// memStore is an in-memory survey.Store, enough to drive the service's own
// rules — normalisation before the store, active/archived split, the
// archive stamp. The SQL's behaviour is surveystore's tests' job.
type memStore struct {
	surveys   map[int64]survey.Survey
	questions map[int64][]survey.Question
	counts    map[int64]int
	added     []survey.QuestionDraft
	nextID    int64
}

func newMemStore() *memStore {
	return &memStore{surveys: map[int64]survey.Survey{}, questions: map[int64][]survey.Question{}, counts: map[int64]int{}}
}

func (m *memStore) CreateSurvey(_ context.Context, s survey.Survey) (survey.Survey, error) {
	m.nextID++
	s.ID = m.nextID
	m.surveys[s.ID] = s
	return s, nil
}

func (m *memStore) SurveyByID(_ context.Context, id int64) (survey.Survey, error) {
	s, ok := m.surveys[id]
	if !ok {
		return survey.Survey{}, survey.ErrSurveyNotFound
	}
	return s, nil
}

func (m *memStore) SurveysForCourse(_ context.Context, courseID int64) ([]survey.Survey, error) {
	var out []survey.Survey
	for id := m.nextID; id >= 1; id-- {
		if s, ok := m.surveys[id]; ok && s.CourseID == courseID {
			out = append(out, s)
		}
	}
	return out, nil
}

func (m *memStore) QuestionCounts(context.Context, int64) (map[int64]int, error) {
	return m.counts, nil
}

func (m *memStore) UpdateSurvey(_ context.Context, id int64, d survey.SurveyDraft, now time.Time) error {
	s, ok := m.surveys[id]
	if !ok {
		return survey.ErrSurveyNotFound
	}
	s.Name, s.Description, s.UpdatedAt = d.Name, d.Description, now
	m.surveys[id] = s
	return nil
}

func (m *memStore) SetArchived(_ context.Context, id int64, at *time.Time, now time.Time) error {
	s, ok := m.surveys[id]
	if !ok {
		return survey.ErrSurveyNotFound
	}
	s.ArchivedAt, s.UpdatedAt = at, now
	m.surveys[id] = s
	return nil
}

func (m *memStore) Questions(_ context.Context, surveyID int64) ([]survey.Question, error) {
	if _, ok := m.surveys[surveyID]; !ok {
		return nil, survey.ErrSurveyNotFound
	}
	return m.questions[surveyID], nil
}

func (m *memStore) AddQuestion(_ context.Context, surveyID int64, d survey.QuestionDraft, _ time.Time) (survey.Question, error) {
	m.added = append(m.added, d)
	m.nextID++
	q := survey.Question{ID: m.nextID, SurveyID: surveyID, Position: len(m.questions[surveyID]) + 1,
		Kind: d.Kind, Statement: d.Statement, Section: d.Section}
	m.questions[surveyID] = append(m.questions[surveyID], q)
	return q, nil
}

func (m *memStore) UpdateQuestion(_ context.Context, _, _ int64, d survey.QuestionDraft, _ time.Time) error {
	m.added = append(m.added, d)
	return nil
}

func (m *memStore) DeleteQuestion(context.Context, int64, int64, time.Time) error { return nil }

func (m *memStore) MoveQuestion(context.Context, int64, int64, int, time.Time) error { return nil }

var now = time.Date(2026, time.October, 5, 12, 0, 0, 0, time.UTC)

func newService(store survey.Store) *survey.Service {
	return survey.NewService(survey.Service{Store: store, Now: func() time.Time { return now }})
}

func TestNewServiceRefusesMissingDependencies(t *testing.T) {
	for name, deps := range map[string]survey.Service{
		"no store": {Now: time.Now},
		"no clock": {Store: newMemStore()},
	} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Error("NewService did not panic")
				}
			}()
			survey.NewService(deps)
		})
	}
}

func TestCreatingASurveyNormalizesAndStampsIt(t *testing.T) {
	store := newMemStore()
	got, err := newService(store).CreateSurvey(context.Background(), 7, 3,
		survey.SurveyDraft{Name: "  Autoevaluación ", Description: " Anónima "})
	if err != nil {
		t.Fatalf("CreateSurvey: %v", err)
	}
	stored := store.surveys[got.ID]
	if stored.Name != "Autoevaluación" || stored.Description != "Anónima" || stored.CourseID != 7 ||
		stored.CreatedBy != 3 || !stored.CreatedAt.Equal(now) || !stored.UpdatedAt.Equal(now) {
		t.Errorf("stored %+v", stored)
	}
}

func TestAnInvalidSurveyNeverReachesTheStore(t *testing.T) {
	store := newMemStore()
	_, err := newService(store).CreateSurvey(context.Background(), 7, 3, survey.SurveyDraft{Name: " "})
	if !errors.Is(err, survey.ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
	if len(store.surveys) != 0 {
		t.Error("the store received an invalid survey")
	}
}

func TestSurveysForCourseSplitsActiveFromArchivedWithCounts(t *testing.T) {
	store := newMemStore()
	svc := newService(store)
	ctx := context.Background()
	active, _ := svc.CreateSurvey(ctx, 7, 3, survey.SurveyDraft{Name: "Activa"})
	archived, _ := svc.CreateSurvey(ctx, 7, 3, survey.SurveyDraft{Name: "Archivada"})
	if err := svc.Archive(ctx, archived.ID); err != nil {
		t.Fatalf("Archive: %v", err)
	}
	store.counts = map[int64]int{active.ID: 4}

	got, err := svc.SurveysForCourse(ctx, 7)
	if err != nil {
		t.Fatalf("SurveysForCourse: %v", err)
	}
	if len(got.Active) != 1 || got.Active[0].Survey.ID != active.ID || got.Active[0].Questions != 4 {
		t.Errorf("active = %+v", got.Active)
	}
	if len(got.Archived) != 1 || got.Archived[0].Survey.ID != archived.ID || got.Archived[0].Questions != 0 {
		t.Errorf("archived = %+v", got.Archived)
	}
	if !store.surveys[archived.ID].ArchivedAt.Equal(now) {
		t.Errorf("archived_at = %v, want the service clock", store.surveys[archived.ID].ArchivedAt)
	}

	if err := svc.Restore(ctx, archived.ID); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if store.surveys[archived.ID].Archived() {
		t.Error("Restore left the survey archived")
	}
}

func TestAQuestionIsNormalizedBeforeTheStoreSeesIt(t *testing.T) {
	store := newMemStore()
	svc := newService(store)
	ctx := context.Background()
	s, _ := svc.CreateSurvey(ctx, 7, 3, survey.SurveyDraft{Name: "Banco"})

	if _, err := svc.AddQuestion(ctx, s.ID, survey.QuestionDraft{
		Kind: survey.KindSingle, Statement: " ¿Sección? ", Labels: []string{"A", "", "B"},
	}); err != nil {
		t.Fatalf("AddQuestion: %v", err)
	}
	if got := store.added[0]; got.Statement != "¿Sección?" || strings.Join(got.Labels, ",") != "A,B" {
		t.Errorf("the store got %+v, want it normalized", got)
	}

	_, err := svc.AddQuestion(ctx, s.ID, survey.QuestionDraft{Kind: survey.KindSingle, Statement: ""})
	if !errors.Is(err, survey.ErrInvalid) || len(store.added) != 1 {
		t.Errorf("an invalid question: err = %v, store calls = %d; want ErrInvalid and no call", err, len(store.added))
	}
	err = svc.UpdateQuestion(ctx, s.ID, 99, survey.QuestionDraft{Kind: "ranking", Statement: "¿?"})
	if !errors.Is(err, survey.ErrInvalid) || len(store.added) != 1 {
		t.Errorf("an invalid update: err = %v, store calls = %d; want ErrInvalid and no call", err, len(store.added))
	}
}

func TestQuestionFindsOneQuestionOfTheBankOrIsNotFound(t *testing.T) {
	store := newMemStore()
	svc := newService(store)
	ctx := context.Background()
	s, _ := svc.CreateSurvey(ctx, 7, 3, survey.SurveyDraft{Name: "Banco"})
	q, _ := svc.AddQuestion(ctx, s.ID, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿?", Labels: []string{"A", "B"}})

	got, err := svc.Question(ctx, s.ID, q.ID)
	if err != nil || got.ID != q.ID {
		t.Errorf("Question = %+v, %v", got, err)
	}
	if _, err := svc.Question(ctx, s.ID, q.ID+50); !errors.Is(err, survey.ErrQuestionNotFound) {
		t.Errorf("an unknown question: %v, want ErrQuestionNotFound", err)
	}
}

func TestMoveAcceptsOnlyOneStep(t *testing.T) {
	store := newMemStore()
	svc := newService(store)
	for _, delta := range []int{0, 2, -3} {
		if err := svc.MoveQuestion(context.Background(), 1, 1, delta); err == nil {
			t.Errorf("delta %d accepted", delta)
		}
	}
}

func TestSectionsGroupConsecutiveQuestionsInBankOrder(t *testing.T) {
	q := func(id int64, section string) survey.Question {
		return survey.Question{ID: id, Section: section}
	}
	got := survey.Sections([]survey.Question{
		q(1, ""), q(2, "Contexto"), q(3, "Contexto"), q(4, "Confianza"), q(5, ""), q(6, "Contexto"),
	})

	var shape []string
	for _, s := range got {
		ids := make([]string, len(s.Questions))
		for i, question := range s.Questions {
			ids[i] = string(rune('0' + question.ID))
		}
		shape = append(shape, s.Label+":"+strings.Join(ids, ""))
	}
	// Consecutive, never merged: the sheet prints in bank order, and a
	// heading that gathered question 6 back under question 2's would show
	// the professor an order the paper does not have.
	want := ":1|Contexto:23|Confianza:4|:5|Contexto:6"
	if strings.Join(shape, "|") != want {
		t.Errorf("sections = %s, want %s", strings.Join(shape, "|"), want)
	}
	if len(survey.Sections(nil)) != 0 {
		t.Error("an empty bank has sections")
	}
}
