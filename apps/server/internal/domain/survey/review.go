package survey

import (
	"context"
	"errors"
	"fmt"
)

// The review queue (issue #311, screen 11): the professor decides, copy by
// copy, what each doubtful or ambiguous answer records.

// Decision is what the professor chose for one item. A decision that is
// neither a discard nor a choice leaves the item pending — "Saltar" is a
// legitimate answer to a sheet that needs a second look.
type Decision struct {
	ItemID         int64
	Discard        bool
	AlternativeIDs []int64
	Comment        string
}

// ErrBadChoice refuses a choice the question cannot record: none, more
// than one on a single or scale question, or an alternative that is not
// the question's.
var ErrBadChoice = errors.New("survey: that choice cannot be recorded for the question")

// MaxCommentLength bounds a review comment.
const MaxCommentLength = 500

// ResolveCopy records the professor's decisions on one copy's items, all
// or none. It returns how many items it decided.
func (s *Service) ResolveCopy(ctx context.Context, surveyID, runID int64, copyNumber int, decisions []Decision, by int64) (int, error) {
	run, err := s.Store.Run(ctx, surveyID, runID)
	if err != nil {
		return 0, err
	}
	if run.State != RunOpen {
		return 0, fmt.Errorf("survey: reviewing run %d: %w", runID, ErrRunNotOpen)
	}
	view, err := s.Copy(ctx, runID, copyNumber)
	if err != nil {
		return 0, err
	}
	questions, _, err := s.QuestionsOf(ctx, run)
	if err != nil {
		return 0, err
	}
	items := make(map[int64]ReviewItem, len(view.Items))
	for _, it := range view.Items {
		items[it.ID] = it
	}

	var out []ItemResolution
	for _, d := range decisions {
		item, ok := items[d.ItemID]
		if !ok {
			return 0, fmt.Errorf("survey: item %d on copy %d: %w", d.ItemID, copyNumber, ErrItemNotFound)
		}
		comment := d.Comment
		if r := []rune(comment); len(r) > MaxCommentLength {
			comment = string(r[:MaxCommentLength])
		}
		switch {
		case d.Discard:
			out = append(out, ItemResolution{ItemID: item.ID, Resolution: ResolutionDiscarded, Comment: comment})
		case len(d.AlternativeIDs) > 0:
			if err := validChoice(questions[item.QuestionID], d.AlternativeIDs); err != nil {
				return 0, fmt.Errorf("survey: item %d: %w", item.ID, err)
			}
			out = append(out, ItemResolution{
				ItemID: item.ID, Resolution: ResolutionChosen, AlternativeIDs: d.AlternativeIDs, Comment: comment,
			})
		}
	}
	if len(out) == 0 {
		return 0, nil
	}
	if err := s.Store.ResolveItems(ctx, runID, view.Copy.ID, out, by, s.Now()); err != nil {
		return 0, err
	}
	return len(out), nil
}

func validChoice(q Question, chosen []int64) error {
	if q.ID == 0 {
		return fmt.Errorf("%w: the question is not in the run", ErrBadChoice)
	}
	if q.Kind != KindMulti && len(chosen) != 1 {
		return fmt.Errorf("%w: %d alternatives on a one-answer question", ErrBadChoice, len(chosen))
	}
	own := make(map[int64]bool, len(q.Alternatives))
	for _, a := range q.Alternatives {
		own[a.ID] = true
	}
	seen := make(map[int64]bool, len(chosen))
	for _, id := range chosen {
		if !own[id] || seen[id] {
			return fmt.Errorf("%w: alternative %d", ErrBadChoice, id)
		}
		seen[id] = true
	}
	return nil
}

// PendingCopies are the run's copies that still have an item to review,
// in order.
func (s *Service) PendingCopies(ctx context.Context, runID int64) ([]int, error) {
	return s.Store.PendingCopyNumbers(ctx, runID)
}

// QuestionsOf returns the questions a run printed with their printed
// numbers, for the review page.
func (s *Service) QuestionsOf(ctx context.Context, run Run) (map[int64]Question, map[int64]int, error) {
	printed, numbers, err := s.printedQuestions(ctx, run)
	if err != nil {
		return nil, nil, err
	}
	questions := make(map[int64]Question, len(printed))
	for _, q := range printed {
		questions[q.ID] = q
	}
	return questions, numbers, nil
}
