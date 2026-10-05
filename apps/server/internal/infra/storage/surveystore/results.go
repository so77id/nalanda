package surveystore

import (
	"context"
	"fmt"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// A run's results (issue #312): counts only, one aggregate query per page
// (apps/server/CLAUDE.md, never one query per question). The arithmetic
// is the domain's (survey.StatsFor, survey.Compare).
//
// Each query is a UNION ALL of three counts over one set of copies, tagged
// by what they count:
//
//	copies    0               how many copies are in the set
//	alt       alternative id  copies that marked it (one mark row per copy)
//	answered  question id     copies with at least one mark on it

// RunTally counts one run, maybe filtered by a context answer.
func (s *Store) RunTally(ctx context.Context, runID int64, filter *survey.ContextFilter) (survey.Tally, error) {
	set := `SELECT id FROM survey_copy WHERE run_id = ?`
	args := []any{runID}
	if filter != nil {
		if len(filter.AlternativeIDs) == 0 {
			set += ` AND 0`
		} else {
			set += ` AND id IN (SELECT copy_id FROM survey_mark WHERE question_id = ? AND alternative_id IN (` +
				placeholders(len(filter.AlternativeIDs)) + `))`
			args = append(args, filter.QuestionID)
			for _, a := range filter.AlternativeIDs {
				args = append(args, a)
			}
		}
	}
	query := `WITH c AS (` + set + `)
        SELECT 'copies', 0, count(*) FROM c
        UNION ALL
        SELECT 'alt', m.alternative_id, count(*) FROM survey_mark m JOIN c ON c.id = m.copy_id GROUP BY m.alternative_id
        UNION ALL
        SELECT 'answered', m.question_id, count(DISTINCT m.copy_id) FROM survey_mark m JOIN c ON c.id = m.copy_id GROUP BY m.question_id`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return survey.Tally{}, fmt.Errorf("surveystore.RunTally for run %d: %w", runID, err)
	}
	defer func() { _ = rows.Close() }()
	t := newTally()
	for rows.Next() {
		var tag string
		var key int64
		var n int
		if err := rows.Scan(&tag, &key, &n); err != nil {
			return survey.Tally{}, fmt.Errorf("surveystore.RunTally for run %d: %w", runID, err)
		}
		t.add(tag, key, n)
	}
	if err := rows.Err(); err != nil {
		return survey.Tally{}, fmt.Errorf("surveystore.RunTally for run %d: %w", runID, err)
	}
	return t.Tally, nil
}

// ClosedRunTallies counts every closed run of a survey and what each
// printed, in one query.
func (s *Store) ClosedRunTallies(ctx context.Context, surveyID int64) ([]survey.RunTally, error) {
	runs, err := s.RunsForSurvey(ctx, surveyID)
	if err != nil {
		return nil, err
	}
	byID := map[int64]*survey.RunTally{}
	var order []int64
	for _, r := range runs {
		if r.State != survey.RunClosed {
			continue
		}
		byID[r.ID] = &survey.RunTally{Run: r, Printed: map[int64]bool{}, Tally: newTally().Tally}
		order = append(order, r.ID)
	}
	if len(order) == 0 {
		return nil, nil
	}

	rows, err := s.db.QueryContext(ctx, `
        WITH c AS (SELECT sc.id, sc.run_id FROM survey_copy sc JOIN survey_run r ON r.id = sc.run_id
                   WHERE r.survey_id = ? AND r.state = 'closed')
        SELECT c.run_id, 'copies', 0, count(*) FROM c GROUP BY c.run_id
        UNION ALL
        SELECT c.run_id, 'alt', m.alternative_id, count(*) FROM survey_mark m JOIN c ON c.id = m.copy_id
            GROUP BY c.run_id, m.alternative_id
        UNION ALL
        SELECT c.run_id, 'answered', m.question_id, count(DISTINCT m.copy_id) FROM survey_mark m JOIN c ON c.id = m.copy_id
            GROUP BY c.run_id, m.question_id
        UNION ALL
        SELECT rq.run_id, 'printed', rq.question_id, rq.printed_number FROM survey_run_question rq
            JOIN survey_run r ON r.id = rq.run_id WHERE r.survey_id = ? AND r.state = 'closed'`,
		surveyID, surveyID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.ClosedRunTallies for survey %d: %w", surveyID, err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var runID, key int64
		var tag string
		var n int
		if err := rows.Scan(&runID, &tag, &key, &n); err != nil {
			return nil, fmt.Errorf("surveystore.ClosedRunTallies for survey %d: %w", surveyID, err)
		}
		rt, ok := byID[runID]
		if !ok {
			continue // closed between the two reads; the next page shows it
		}
		switch tag {
		case "printed":
			rt.Printed[key] = true
		case "copies":
			rt.Tally.Copies = n
		case "alt":
			rt.Tally.Counts[key] = n
		case "answered":
			rt.Tally.Answered[key] = n
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("surveystore.ClosedRunTallies for survey %d: %w", surveyID, err)
	}
	out := make([]survey.RunTally, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out, nil
}

// tallyBuilder fills a Tally from tagged rows.
type tallyBuilder struct{ survey.Tally }

func newTally() *tallyBuilder {
	return &tallyBuilder{survey.Tally{Counts: map[int64]int{}, Answered: map[int64]int{}}}
}

func (b *tallyBuilder) add(tag string, key int64, n int) {
	switch tag {
	case "copies":
		b.Copies = n
	case "alt":
		b.Counts[key] = n
	case "answered":
		b.Answered[key] = n
	}
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}
