package stats_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls/stats"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// Item analysis walks the SAME answers the grade math walks: an answer
// dropped from the row (not_present, unreadable RUT without override,
// doubtful/ambiguous without override) is invisible here too. The
// per-question numbers therefore never contradict the row-level grade
// the readings table prints. Bank access is required — the panel needs
// each question's alternative count and correct set to label letters
// and colour columns.

// bankFor builds a minimal bank with one question of the requested
// type and correct set. Alternatives is len 5 for the letters
// A/B/C/D/E; the actual alternative text is unused.
func bankFor(id string, kind string, correct []int, altCount int) *bank.Bank {
	alts := make([]string, altCount)
	for i := range alts {
		alts[i] = string(rune('A' + i))
	}
	b, err := bank.Parse(fakeBankJSON(id, kind, correct, alts))
	if err != nil {
		panic(err)
	}
	return b
}

// fakeBankJSON emits a minimal questions.json for one question.
func fakeBankJSON(id, kind string, correct []int, alts []string) *strings.Reader {
	buf := `{
	"version": 1,
	"documents": [{"id":"doc","title":"","coverage":"","sections":["s1"]}],
	"questions": [{
		"id":"` + id + `",
		"document":"doc",
		"anchor":"s1",
		"type":"` + kind + `",
		"statement":"El enunciado",
		"code":null,
		"alternatives":` + alternativesJSON(alts) + `,
		"correct":` + correctJSON(correct) + `
	}]
}`
	return strings.NewReader(buf)
}

// answer builds a valid OK answer for question `ref` with a single
// mark on the given 1-based authoring index. Score/Max reflect a
// simple question (score=1 when marked=correct index, score=0 else).
func answer(ref string, oneBasedMark int) controls.Answer {
	return controls.Answer{
		QuestionRef:  ref,
		QuestionType: controls.QuestionSimple,
		Status:       controls.AnswerStatusOK,
		Marked:       []int{oneBasedMark},
		Score:        1,
		Max:          1,
	}
}

func answerWrong(ref string, oneBasedMark int) controls.Answer {
	return controls.Answer{
		QuestionRef:  ref,
		QuestionType: controls.QuestionSimple,
		Status:       controls.AnswerStatusOK,
		Marked:       []int{oneBasedMark},
		Score:        0,
		Max:          1,
	}
}

func answerBlank(ref string) controls.Answer {
	return controls.Answer{
		QuestionRef:  ref,
		QuestionType: controls.QuestionSimple,
		Status:       controls.AnswerStatusBlank,
		Score:        0,
		Max:          1,
	}
}

func answerDoubtful(ref string) controls.Answer {
	return controls.Answer{
		QuestionRef:  ref,
		QuestionType: controls.QuestionSimple,
		Status:       controls.AnswerStatusDoubtful,
		Score:        0,
		Max:          1,
	}
}

func answerAmbiguous(ref string, marks []int) controls.Answer {
	return controls.Answer{
		QuestionRef:  ref,
		QuestionType: controls.QuestionSimple,
		Status:       controls.AnswerStatusAmbiguous,
		Marked:       marks,
		Score:        0,
		Max:          1,
	}
}

func answerOverride(ref string) controls.Answer {
	return controls.Answer{
		QuestionRef:  ref,
		QuestionType: controls.QuestionSimple,
		Status:       controls.AnswerStatusDoubtful,
		Marked:       []int{1},
		Score:        0,
		Max:          1,
		Override: &controls.AnswerOverride{
			Marked: []int{2},
			Status: controls.AnswerStatusOK,
		},
	}
}

// TestPerQuestionDificultadIsPercentageFullyCorrect: 5 copies, correct is
// alternative index 0 (letter A, 1-based mark = 1). Three copies marked 1,
// one marked 2 (wrong), one blank. Dificultad = 3/5 = 60%.
func TestPerQuestionDificultadIsPercentageFullyCorrect(t *testing.T) {
	b := bankFor("q1", "simple", []int{0}, 5)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answer("q1", 1)}),
		reading(2, []controls.Answer{answer("q1", 1)}),
		reading(3, []controls.Answer{answer("q1", 1)}),
		reading(4, []controls.Answer{answerWrong("q1", 2)}),
		reading(5, []controls.Answer{answerBlank("q1")}),
	}
	s := stats.Compute(readings, b, 1)
	if len(s.PerQuestion) != 1 {
		t.Fatalf("PerQuestion length = %d, want 1", len(s.PerQuestion))
	}
	q := s.PerQuestion[0]
	if q.QuestionRef != "q1" {
		t.Errorf("QuestionRef = %q, want q1", q.QuestionRef)
	}
	if !closeEnough(q.Dificultad, 60.0) {
		t.Errorf("Dificultad = %v, want 60.0", q.Dificultad)
	}
}

// TestPerQuestionAlternativeDistributionSumsToNForSimpleQuestions:
// AC-4: sums to N for simple questions (each copy contributes one
// letter OR blanco OR inválida).
func TestPerQuestionAlternativeDistributionSumsToNForSimpleQuestions(t *testing.T) {
	b := bankFor("q1", "simple", []int{0}, 5)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answer("q1", 1)}),                    // letter A
		reading(2, []controls.Answer{answer("q1", 1)}),                    // letter A
		reading(3, []controls.Answer{answerWrong("q1", 2)}),               // letter B
		reading(4, []controls.Answer{answerWrong("q1", 3)}),               // letter C
		reading(5, []controls.Answer{answerBlank("q1")}),                  // blank
		reading(6, []controls.Answer{answerAmbiguous("q1", []int{1, 2})}), // invalid (whole copy dropped by grade)
		reading(7, []controls.Answer{answerOverride("q1")}),               // invalid — override
	}
	s := stats.Compute(readings, b, 1)
	q := s.PerQuestion[0]
	// N counts only readings with a defined grade. The ambiguous
	// answer without override drops the whole copy — so it does not
	// appear in the item analysis (AC-3). The override is invalid for
	// item analysis (AC-4) but its copy is graded — the copy still
	// counts toward N via TotalAndGrade's override-worth-1.0 rule.
	// Blank + wrong + right + override count = 6.
	if q.N != 6 {
		t.Errorf("PerQuestion N = %d, want 6", q.N)
	}
	// A (1-based 1): 2, B (1-based 2): 1, C: 1, D: 0, E: 0
	want := []int{2, 1, 1, 0, 0}
	for i, c := range q.AltDistribution {
		if c != want[i] {
			t.Errorf("AltDistribution[%d] = %d, want %d", i, c, want[i])
		}
	}
	if q.Blank != 1 {
		t.Errorf("Blank = %d, want 1", q.Blank)
	}
	if q.Invalid != 1 {
		t.Errorf("Invalid = %d, want 1", q.Invalid)
	}
	// Sum-to-N invariant for simple questions.
	got := q.Blank + q.Invalid
	for _, c := range q.AltDistribution {
		got += c
	}
	if got != q.N {
		t.Errorf("distribution sum = %d, want N = %d", got, q.N)
	}
}

// TestPerQuestionPctBlancoAndErrada: the two rate views the panel
// surfaces beside dificultad. Blanco is blank / N; Errada is OK-but-
// not-fully-correct / N.
func TestPerQuestionPctBlancoAndErrada(t *testing.T) {
	b := bankFor("q1", "simple", []int{0}, 4)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answer("q1", 1)}),      // correct
		reading(2, []controls.Answer{answerWrong("q1", 2)}), // errada
		reading(3, []controls.Answer{answerWrong("q1", 3)}), // errada
		reading(4, []controls.Answer{answerBlank("q1")}),    // blanco
	}
	s := stats.Compute(readings, b, 1)
	q := s.PerQuestion[0]
	if !closeEnough(q.PctBlanco, 25.0) {
		t.Errorf("PctBlanco = %v, want 25.0", q.PctBlanco)
	}
	if !closeEnough(q.PctErrada, 50.0) {
		t.Errorf("PctErrada = %v, want 50.0", q.PctErrada)
	}
}

// TestPctErradaCountsOKWrongsEvenWithOverrides pins the four-bucket
// invariant against the pre-fix double-subtraction of the override
// bucket (issue #251 review, COR-1). 10 copies: 5 raw correct, 2 raw
// wrong, 2 overridden (fullyCorrect via TotalAndGrade rule), 1 blank.
// PctErrada must reflect the two real OK-wrong answers (20 %), not
// 0 % — the shape that landed green on the first review round.
func TestPctErradaCountsOKWrongsEvenWithOverrides(t *testing.T) {
	b := bankFor("q1", "simple", []int{0}, 4)
	var readings []controls.Reading
	for i := 1; i <= 5; i++ {
		readings = append(readings, reading(i, []controls.Answer{answer("q1", 1)}))
	}
	for i := 6; i <= 7; i++ {
		readings = append(readings, reading(i, []controls.Answer{answerWrong("q1", 2)}))
	}
	for i := 8; i <= 9; i++ {
		readings = append(readings, reading(i, []controls.Answer{answerOverride("q1")}))
	}
	readings = append(readings, reading(10, []controls.Answer{answerBlank("q1")}))

	q := stats.Compute(readings, b, 1).PerQuestion[0]
	if q.N != 10 {
		t.Errorf("N = %d, want 10", q.N)
	}
	if !closeEnough(q.Dificultad, 70.0) {
		t.Errorf("Dificultad = %v, want 70.0 (5 raw correct + 2 overrides of 10)", q.Dificultad)
	}
	if !closeEnough(q.PctErrada, 20.0) {
		t.Errorf("PctErrada = %v, want 20.0 (2 real OK-wrongs of 10)", q.PctErrada)
	}
	if !closeEnough(q.PctBlanco, 10.0) {
		t.Errorf("PctBlanco = %v, want 10.0", q.PctBlanco)
	}
	// Three-bucket sum-to-100 invariant: every graded copy contributes
	// to exactly one of {fully-correct (Dificultad), OK-wrong
	// (PctErrada), blank (PctBlanco)}. An override lands in Dificultad
	// (TotalAndGrade earns the full point) AND in the Invalid bucket
	// for the distribution — Invalid is therefore an intersection view
	// of Dificultad, not a fourth disjoint bucket, and summing it in
	// would double-count.
	if got := q.Dificultad + q.PctErrada + q.PctBlanco; !closeEnough(got, 100.0) {
		t.Errorf("three-bucket sum = %v, want 100.0 (Dificultad %.1f + Errada %.1f + Blanco %.1f)",
			got, q.Dificultad, q.PctErrada, q.PctBlanco)
	}
}

func TestPerQuestionOverrideCountsAsCorrectForDificultadInvalidForDistribution(t *testing.T) {
	// The override earns the full point (TotalAndGrade rule), so
	// dificultad counts it as correct. The distribution cannot tell
	// which letter to attribute it to, so it goes to "inválida"
	// (AC-4).
	b := bankFor("q1", "simple", []int{0}, 5)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answerOverride("q1")}),
	}
	s := stats.Compute(readings, b, 1)
	q := s.PerQuestion[0]
	if !closeEnough(q.Dificultad, 100.0) {
		t.Errorf("Dificultad = %v, want 100.0 (override is a full point)", q.Dificultad)
	}
	if q.Invalid != 1 {
		t.Errorf("Invalid = %d, want 1", q.Invalid)
	}
	sum := q.Blank + q.Invalid
	for _, c := range q.AltDistribution {
		sum += c
	}
	if sum != q.N {
		t.Errorf("distribution sum = %d, want N = %d", sum, q.N)
	}
}

func TestPerQuestionEmptyWhenNoReadings(t *testing.T) {
	b := bankFor("q1", "simple", []int{0}, 4)
	s := stats.Compute(nil, b, 1)
	if len(s.PerQuestion) != 0 {
		t.Errorf("PerQuestion len = %d, want 0", len(s.PerQuestion))
	}
}

func TestPerQuestionMissingBankStatementUsesQuestionRef(t *testing.T) {
	// A question referenced by the reading that no longer lives in the
	// bank (authored, then removed after the control was frozen). The
	// panel still tallies the answer, but the row uses the ref as
	// label so the professor sees which question is missing metadata.
	b := bankFor("known", "simple", []int{0}, 4)
	readings := []controls.Reading{
		reading(1, []controls.Answer{answer("orphan", 1)}),
	}
	s := stats.Compute(readings, b, 1)
	if len(s.PerQuestion) != 1 {
		t.Fatalf("PerQuestion len = %d, want 1", len(s.PerQuestion))
	}
	q := s.PerQuestion[0]
	if q.QuestionRef != "orphan" {
		t.Errorf("QuestionRef = %q, want orphan", q.QuestionRef)
	}
	if q.Statement != "" {
		t.Errorf("Statement = %q, want empty (bank missed)", q.Statement)
	}
	// No alternative count means no distribution slots.
	if q.AltCount != 0 {
		t.Errorf("AltCount = %d, want 0 (unknown)", q.AltCount)
	}
}

func alternativesJSON(alts []string) string {
	parts := make([]string, len(alts))
	for i, a := range alts {
		parts[i] = `"` + a + `"`
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func correctJSON(correct []int) string {
	parts := make([]string, len(correct))
	for i, c := range correct {
		parts[i] = strconv.Itoa(c)
	}
	return "[" + strings.Join(parts, ",") + "]"
}
