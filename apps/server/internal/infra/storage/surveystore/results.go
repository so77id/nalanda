package surveystore

import (
	"context"
	"database/sql"
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
	// The filter is a correlated EXISTS on the mark's primary key (copy,
	// question, alternative): an IN over survey_mark by question scanned
	// every mark of every survey ever (#312 review, PERF-1, measured).
	set := `SELECT id FROM survey_copy sc WHERE run_id = ?`
	args := []any{runID}
	if filter != nil {
		if len(filter.AlternativeIDs) == 0 {
			set += ` AND 0`
		} else {
			set += ` AND EXISTS (SELECT 1 FROM survey_mark f WHERE f.copy_id = sc.id AND f.question_id = ?
                                 AND f.alternative_id IN (` + placeholders(len(filter.AlternativeIDs)) + `))`
			args = append(args, filter.QuestionID)
			for _, a := range filter.AlternativeIDs {
				args = append(args, a)
			}
		}
	}
	// The run's read copies, unfiltered, in the same query (PERF-2).
	args = append(args, runID)
	query := `WITH c AS (` + set + `)
        SELECT 'read', 0, count(*) FROM survey_copy WHERE run_id = ?
        UNION ALL
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
	return *t.Tally, nil
}

// ClosedRunTallies counts every closed run of a survey and what each
// printed, in one query.
func (s *Store) ClosedRunTallies(ctx context.Context, surveyID int64) ([]survey.ClosedRunTally, error) {
	runs, err := s.RunsForSurvey(ctx, surveyID)
	if err != nil {
		return nil, err
	}
	builders := map[int64]*tallyBuilder{}
	var closed []survey.Run
	for _, r := range runs {
		if r.State != survey.RunClosed {
			continue
		}
		builders[r.ID] = newTally()
		closed = append(closed, r)
	}
	if len(closed) == 0 {
		return nil, nil
	}

	rows, err := s.db.QueryContext(ctx, `
        WITH c AS (SELECT sc.id, sc.run_id FROM survey_copy sc JOIN survey_run r ON r.id = sc.run_id
                   WHERE r.survey_id = ? AND r.state = 'closed')
        SELECT c.run_id, 'copies', 0, count(*) FROM c GROUP BY c.run_id
        UNION ALL
        SELECT c.run_id, 'read', 0, count(*) FROM c GROUP BY c.run_id
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
		b, ok := builders[runID]
		if !ok {
			continue // closed between the two reads; the next page shows it
		}
		b.add(tag, key, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("surveystore.ClosedRunTallies for survey %d: %w", surveyID, err)
	}
	out := make([]survey.ClosedRunTally, 0, len(closed))
	for _, r := range closed {
		b := builders[r.ID]
		out = append(out, survey.ClosedRunTally{Run: r, Printed: b.printed, Tally: *b.Tally})
	}
	return out, nil
}

// tallyBuilder fills a Tally from tagged rows — the one place a tag means
// something (#312 review, ARQ-3).
type tallyBuilder struct {
	*survey.Tally
	// printed is ClosedRunTallies' "printed" tag: the questions a run
	// printed.
	printed map[int64]bool
}

func newTally() *tallyBuilder {
	return &tallyBuilder{&survey.Tally{Counts: map[int64]int{}, Answered: map[int64]int{}}, map[int64]bool{}}
}

func (b *tallyBuilder) add(tag string, key int64, n int) {
	switch tag {
	case "read":
		b.ReadCopies = n
	case "copies":
		b.Copies = n
	case "alt":
		b.Counts[key] = n
	case "answered":
		b.Answered[key] = n
	case "printed":
		b.printed[key] = true
	}
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}

// RunMarks returns a run's copies and their marks, one query; a copy with
// no mark at all still appears (LEFT JOIN), as a row of blanks.
func (s *Store) RunMarks(ctx context.Context, runID int64) ([]survey.CopyMarks, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT c.copy_number, m.question_id, m.alternative_id
        FROM survey_copy c LEFT JOIN survey_mark m ON m.copy_id = c.id
        WHERE c.run_id = ?
        ORDER BY c.copy_number, m.question_id, m.alternative_id`, runID)
	if err != nil {
		return nil, fmt.Errorf("surveystore.RunMarks for run %d: %w", runID, err)
	}
	defer func() { _ = rows.Close() }()
	var out []survey.CopyMarks
	for rows.Next() {
		var n int
		var q, a sql.NullInt64
		if err := rows.Scan(&n, &q, &a); err != nil {
			return nil, fmt.Errorf("surveystore.RunMarks for run %d: %w", runID, err)
		}
		if len(out) == 0 || out[len(out)-1].CopyNumber != n {
			out = append(out, survey.CopyMarks{CopyNumber: n, Marks: map[int64][]int64{}})
		}
		if q.Valid {
			last := &out[len(out)-1]
			last.Marks[q.Int64] = append(last.Marks[q.Int64], a.Int64)
		}
	}
	return out, rows.Err()
}
