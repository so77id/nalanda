package bank_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// fixtureJSON is a valid bank with three documents in reading order. It
// exercises every field the reader touches: multiple sections per document,
// a null-anchor question that must be skipped by Pool, a "multiple" type,
// and a question carrying code.
const fixtureJSON = `{
  "version": 1,
  "documents": [
    {"id": "welcome",   "title": "Bienvenida",   "coverage": "clase 0",     "sections": ["hola", "reglas"]},
    {"id": "flujo",     "title": "Flujo",        "coverage": "clase 2",     "sections": ["if-else", "bucles", "cortes"]},
    {"id": "arreglos",  "title": "Arreglos",     "coverage": "clase 3",     "sections": ["basico", "longitud"]}
  ],
  "questions": [
    {"id": "q-hola-1",       "document": "welcome",  "anchor": "hola",      "type": "simple",   "statement": "¿Qué es Nalanda?", "code": null, "alternatives": ["una plataforma","un lenguaje"], "correct": [0]},
    {"id": "q-reglas-1",     "document": "welcome",  "anchor": "reglas",    "type": "simple",   "statement": "R1?",              "code": null, "alternatives": ["a","b"],                             "correct": [0]},
    {"id": "q-orphan",       "document": "welcome",  "anchor": null,        "type": "simple",   "statement": "S/A",              "code": null, "alternatives": ["a","b"],                             "correct": [1]},
    {"id": "q-if-1",         "document": "flujo",    "anchor": "if-else",   "type": "simple",   "statement": "if?",              "code": null, "alternatives": ["a","b"],                             "correct": [0]},
    {"id": "q-bucles-1",     "document": "flujo",    "anchor": "bucles",    "type": "multiple", "statement": "¿Cuáles bucles?",  "code": null, "alternatives": ["for","while","hazlo","ninguno"],     "correct": [0,1]},
    {"id": "q-cortes-1",     "document": "flujo",    "anchor": "cortes",    "type": "simple",   "statement": "corte?",           "code": null, "alternatives": ["a","b"],                             "correct": [0]},
    {"id": "q-arr-basico-1", "document": "arreglos", "anchor": "basico",    "type": "simple",   "statement": "arr?",             "code": {"language": "java", "source": "int[] a = new int[3];"}, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q-arr-longitud-1","document": "arreglos","anchor": "longitud",  "type": "simple",   "statement": "longitud?",        "code": null, "alternatives": ["a.length","a.length()"],             "correct": [0]}
  ]
}
`

func parse(t *testing.T) *bank.Bank {
	t.Helper()
	b, err := bank.Parse(strings.NewReader(fixtureJSON))
	if err != nil {
		t.Fatalf("Parse fixture: %v", err)
	}
	return b
}

func TestParseHoldsEveryFieldTheContractCarries(t *testing.T) {
	b := parse(t)

	if b.Version != 1 {
		t.Errorf("Version = %d, want 1", b.Version)
	}
	if len(b.Documents) != 3 {
		t.Fatalf("Documents count = %d, want 3", len(b.Documents))
	}
	if b.Documents[1].ID != "flujo" || b.Documents[1].Title != "Flujo" || b.Documents[1].Coverage != "clase 2" {
		t.Errorf("Documents[1] = %+v, want {flujo, Flujo, clase 2, …}", b.Documents[1])
	}
	if got := b.Documents[1].Sections; len(got) != 3 || got[0] != "if-else" || got[2] != "cortes" {
		t.Errorf("Documents[1].Sections = %v, want [if-else bucles cortes]", got)
	}

	// Anchor null becomes empty string on the domain side.
	var orphan *bank.Question
	for i := range b.Questions {
		if b.Questions[i].ID == "q-orphan" {
			orphan = &b.Questions[i]
		}
	}
	if orphan == nil {
		t.Fatal("q-orphan missing from parsed questions")
	}
	if orphan.Anchor != "" {
		t.Errorf("q-orphan.Anchor = %q, want empty (null in JSON)", orphan.Anchor)
	}

	// Multiple-type question preserves both correct indices.
	var multi *bank.Question
	for i := range b.Questions {
		if b.Questions[i].ID == "q-bucles-1" {
			multi = &b.Questions[i]
		}
	}
	if multi == nil {
		t.Fatal("q-bucles-1 missing")
	}
	if multi.Type != bank.TypeMultiple {
		t.Errorf("q-bucles-1.Type = %q, want %q", multi.Type, bank.TypeMultiple)
	}
	if got := multi.Correct; len(got) != 2 || got[0] != 0 || got[1] != 1 {
		t.Errorf("q-bucles-1.Correct = %v, want [0 1]", got)
	}

	// Code carries language and source; a nil-code question keeps Code nil.
	var codeQ *bank.Question
	for i := range b.Questions {
		if b.Questions[i].ID == "q-arr-basico-1" {
			codeQ = &b.Questions[i]
		}
	}
	if codeQ == nil || codeQ.Code == nil {
		t.Fatalf("q-arr-basico-1.Code missing")
	}
	if codeQ.Code.Language != "java" || !strings.Contains(codeQ.Code.Source, "new int[3]") {
		t.Errorf("q-arr-basico-1.Code = %+v", codeQ.Code)
	}
}

func TestParseRejectsUnsupportedVersion(t *testing.T) {
	_, err := bank.Parse(strings.NewReader(`{"version": 2, "documents": [], "questions": []}`))
	if !errors.Is(err, bank.ErrUnsupportedVersion) {
		t.Errorf("Parse(version=2): %v, want ErrUnsupportedVersion", err)
	}
}

func TestParseRejectsDuplicateQuestionID(t *testing.T) {
	// ADR-0032: the id is the join key from a printed sheet to a grade,
	// so a duplicate silently merges two students' answers into one
	// column. The emitter fails the BUILD on this; the reader mirrors
	// the check so a bank JSON handed to a server that skipped the
	// build gate is still rejected — otherwise the failure appears
	// later as a PRIMARY KEY conflict on control_pregunta the first
	// time a control draws both.
	const dupJSON = `{
  "version": 1,
  "documents": [
    {"id": "d", "title": "D", "coverage": "c", "sections": ["s"]}
  ],
  "questions": [
    {"id": "same", "document": "d", "anchor": "s", "type": "simple",
     "statement": "A?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "same", "document": "d", "anchor": "s", "type": "simple",
     "statement": "B?", "code": null, "alternatives": ["a","b"], "correct": [0]}
  ]
}`
	_, err := bank.Parse(strings.NewReader(dupJSON))
	if !errors.Is(err, bank.ErrDuplicateQuestionID) {
		t.Errorf("Parse(duplicate id): %v, want ErrDuplicateQuestionID", err)
	}
	if err != nil && !strings.Contains(err.Error(), `"same"`) {
		t.Errorf("error %q does not name the duplicated id", err.Error())
	}
}

func TestParseRejectsMalformedJSON(t *testing.T) {
	_, err := bank.Parse(strings.NewReader(`{version: 1,`))
	if err == nil {
		t.Fatal("Parse(malformed): no error")
	}
	if !strings.Contains(err.Error(), "decode") {
		t.Errorf("error %q does not name 'decode'", err.Error())
	}
}

func TestPoolReturnsQuestionsInsideASingleSection(t *testing.T) {
	b := parse(t)

	pool, err := b.Pool(
		bank.SectionRef{Document: "flujo", Section: "bucles"},
		bank.SectionRef{Document: "flujo", Section: "bucles"},
	)
	if err != nil {
		t.Fatalf("Pool: %v", err)
	}
	if len(pool) != 1 || pool[0].ID != "q-bucles-1" {
		t.Errorf("Pool = %v, want [q-bucles-1]", pool)
	}
}

func TestPoolSpansMultipleDocumentsInReadingOrder(t *testing.T) {
	b := parse(t)

	pool, err := b.Pool(
		bank.SectionRef{Document: "welcome", Section: "reglas"},
		bank.SectionRef{Document: "flujo", Section: "bucles"},
	)
	if err != nil {
		t.Fatalf("Pool: %v", err)
	}
	// Reading order: welcome/reglas → flujo/if-else → flujo/bucles.
	want := []string{"q-reglas-1", "q-if-1", "q-bucles-1"}
	got := make([]string, len(pool))
	for i, q := range pool {
		got[i] = q.ID
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("Pool order = %v, want %v", got, want)
	}
}

func TestPoolSkipsQuestionsWithNoAnchor(t *testing.T) {
	b := parse(t)

	// The whole welcome document. q-orphan has anchor null and must not
	// appear in any range; only q-hola-1 and q-reglas-1 are drawable.
	pool, err := b.Pool(
		bank.SectionRef{Document: "welcome", Section: "hola"},
		bank.SectionRef{Document: "welcome", Section: "reglas"},
	)
	if err != nil {
		t.Fatalf("Pool: %v", err)
	}
	for _, q := range pool {
		if q.ID == "q-orphan" {
			t.Errorf("Pool contained q-orphan (anchor null); a section range must not draw it")
		}
	}
	if len(pool) != 2 {
		t.Errorf("Pool size = %d, want 2 (welcome has one anchor-less question that must be skipped)", len(pool))
	}
}

func TestPoolFailsClosedOnInvertedRange(t *testing.T) {
	b := parse(t)

	_, err := b.Pool(
		bank.SectionRef{Document: "flujo", Section: "cortes"},
		bank.SectionRef{Document: "welcome", Section: "hola"},
	)
	if !errors.Is(err, bank.ErrRangeInverted) {
		t.Errorf("Pool(inverted): %v, want ErrRangeInverted", err)
	}
}

func TestPoolFlagsUnknownDocumentAndUnknownSection(t *testing.T) {
	b := parse(t)

	_, err := b.Pool(
		bank.SectionRef{Document: "does-not-exist", Section: "hola"},
		bank.SectionRef{Document: "welcome", Section: "hola"},
	)
	if !errors.Is(err, bank.ErrUnknownDocument) {
		t.Errorf("Pool(bad doc): %v, want ErrUnknownDocument", err)
	}

	_, err = b.Pool(
		bank.SectionRef{Document: "welcome", Section: "no-existe"},
		bank.SectionRef{Document: "welcome", Section: "hola"},
	)
	if !errors.Is(err, bank.ErrUnknownSection) {
		t.Errorf("Pool(bad section): %v, want ErrUnknownSection", err)
	}
}

func TestFindDocumentAndHasSection(t *testing.T) {
	b := parse(t)

	if _, ok := b.FindDocument("flujo"); !ok {
		t.Errorf("FindDocument(flujo) = false, want true")
	}
	if _, ok := b.FindDocument("no-existe"); ok {
		t.Errorf("FindDocument(no-existe) = true, want false")
	}
	if !b.HasSection(bank.SectionRef{Document: "flujo", Section: "bucles"}) {
		t.Errorf("HasSection(flujo/bucles) = false, want true")
	}
	if b.HasSection(bank.SectionRef{Document: "flujo", Section: "no"}) {
		t.Errorf("HasSection(flujo/no) = true, want false")
	}
}

func TestLoadFileScheme(t *testing.T) {
	path := filepath.Join(t.TempDir(), "questions.json")
	if err := os.WriteFile(path, []byte(fixtureJSON), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	b, err := bank.Load(context.Background(), "file://"+path)
	if err != nil {
		t.Fatalf("Load(file): %v", err)
	}
	if len(b.Documents) != 3 {
		t.Errorf("Load(file) returned %d documents, want 3", len(b.Documents))
	}
}

func TestLoadHTTPScheme(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fixtureJSON))
	}))
	t.Cleanup(srv.Close)

	b, err := bank.Load(context.Background(), srv.URL+"/questions.json")
	if err != nil {
		t.Fatalf("Load(http): %v", err)
	}
	if len(b.Documents) != 3 {
		t.Errorf("Load(http) returned %d documents, want 3", len(b.Documents))
	}
}

func TestLoadRejectsUnsupportedScheme(t *testing.T) {
	_, err := bank.Load(context.Background(), "ftp://example.com/questions.json")
	if !errors.Is(err, bank.ErrUnsupportedScheme) {
		t.Errorf("Load(ftp): %v, want ErrUnsupportedScheme", err)
	}
}

func TestLoadHTTPReportsNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "gone", http.StatusGone)
	}))
	t.Cleanup(srv.Close)

	_, err := bank.Load(context.Background(), srv.URL+"/questions.json")
	if err == nil {
		t.Fatal("Load(410): no error")
	}
	if !strings.Contains(err.Error(), "410") {
		t.Errorf("error %q does not name status 410", err.Error())
	}
}
