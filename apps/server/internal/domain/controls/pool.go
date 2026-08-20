// The pool snapshot: a self-contained backup of what a generated control
// drew from, written beside source.tex at Create time (issue #198). It is
// backup material, not a join source — the database's control_pregunta
// stays authoritative for grading, and this file exists so a control keeps
// its historical questions even after the published bank evolves.
package controls

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// PoolSnapshot is the shape of pool.json. The question half mirrors the
// published bank's questions.json (lowercase keys, same field names) so a
// reader already knows it; the control half is the generation metadata.
// It carries no student data: the pool is the public question bank.
type PoolSnapshot struct {
	Version int `json:"version"`
	Control struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		// Unix seconds, like the control row's column. Null when the form
		// declared no date.
		ApplicationDate  *int64 `json:"application_date"`
		FromDocument     string `json:"from_document"`
		FromSection      string `json:"from_section"`
		ToDocument       string `json:"to_document"`
		ToSection        string `json:"to_section"`
		QuestionsPerCopy int    `json:"questions_per_copy"`
		Copies           int    `json:"copies"`
		DuplexPadding    bool   `json:"duplex_padding"`
		// Paper is "letter" or "a4" (issue #208, ADR-0043). Recorded like
		// DuplexPadding: both are generation-time preferences the backup
		// needs to reproduce source.tex from — ticked/unsure stay off the
		// snapshot because they are read-time thresholds re-set per batch.
		Paper string `json:"paper"`
		Seed  int64  `json:"seed"`
		// Unix seconds. The snapshot's own write time, evaluated when the
		// file is written — the control row's created_at stays where it is
		// (persist time), the two timestamps differ by the generation.
		CreatedAt int64 `json:"created_at"`
	} `json:"control"`
	// Pool is in reading order, the order the generator emitted.
	Pool []PoolQuestion `json:"pool"`
}

// PoolQuestion is one question as it entered the pool, in full — the
// same shape questions.json publishes, so the two files read alike.
type PoolQuestion struct {
	ID           string    `json:"id"`
	Document     string    `json:"document"`
	Anchor       string    `json:"anchor"`
	Type         string    `json:"type"`
	Statement    string    `json:"statement"`
	Code         *PoolCode `json:"code"`
	Alternatives []string  `json:"alternatives"`
	Correct      []int     `json:"correct"`
}

// PoolCode is a staged code listing, nil-safe like the bank's own field.
type PoolCode struct {
	Language string `json:"language"`
	Source   string `json:"source"`
}

// writePoolSnapshot marshals the pool and writes it to path. Called inside
// Create's guarded region: a failure anywhere afterwards rolls the whole
// project directory away, snapshot included — the all-or-nothing contract
// covers this file like any other.
func writePoolSnapshot(path string, id string, req CreateRequest, pool []bank.Question, seed int64, now time.Time) error {
	snap := PoolSnapshot{Version: 1}
	snap.Control.ID = id
	snap.Control.Name = req.Name
	if req.ApplicationDate != nil {
		unix := req.ApplicationDate.Unix()
		snap.Control.ApplicationDate = &unix
	}
	snap.Control.FromDocument = req.RangeFrom.Document
	snap.Control.FromSection = req.RangeFrom.Section
	snap.Control.ToDocument = req.RangeTo.Document
	snap.Control.ToSection = req.RangeTo.Section
	snap.Control.QuestionsPerCopy = req.QuestionsPerCopy
	snap.Control.Copies = req.Copies
	snap.Control.DuplexPadding = req.DuplexPadding
	snap.Control.Paper = string(paperOrDefault(req.Paper))
	snap.Control.Seed = seed
	snap.Control.CreatedAt = now.Unix()

	snap.Pool = make([]PoolQuestion, len(pool))
	for i, q := range pool {
		pq := PoolQuestion{
			ID:           q.ID,
			Document:     q.Document,
			Anchor:       q.Anchor,
			Type:         q.Type,
			Statement:    q.Statement,
			Alternatives: q.Alternatives,
			Correct:      q.Correct,
		}
		if q.Code != nil {
			pq.Code = &PoolCode{Language: q.Code.Language, Source: q.Code.Source}
		}
		snap.Pool[i] = pq
	}

	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}
