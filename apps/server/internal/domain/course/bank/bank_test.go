package bank_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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

// fixtureJSONExtra adds one more document ("nuevo/basico") so a Reload can
// prove it observed the site's publish rather than the boot snapshot.
const fixtureJSONExtra = `{
  "version": 1,
  "documents": [
    {"id": "welcome",   "title": "Bienvenida",   "coverage": "clase 0",     "sections": ["hola", "reglas"]},
    {"id": "flujo",     "title": "Flujo",        "coverage": "clase 2",     "sections": ["if-else", "bucles", "cortes"]},
    {"id": "arreglos",  "title": "Arreglos",     "coverage": "clase 3",     "sections": ["basico", "longitud"]},
    {"id": "nuevo",     "title": "Nuevo",        "coverage": "clase 4",     "sections": ["basico"]}
  ],
  "questions": [
    {"id": "q-hola-1",       "document": "welcome",  "anchor": "hola",      "type": "simple",   "statement": "¿Qué es Nalanda?", "code": null, "alternatives": ["una plataforma","un lenguaje"], "correct": [0]},
    {"id": "q-reglas-1",     "document": "welcome",  "anchor": "reglas",    "type": "simple",   "statement": "R1?",              "code": null, "alternatives": ["a","b"],                             "correct": [0]},
    {"id": "q-orphan",       "document": "welcome",  "anchor": null,        "type": "simple",   "statement": "S/A",              "code": null, "alternatives": ["a","b"],                             "correct": [1]},
    {"id": "q-if-1",         "document": "flujo",    "anchor": "if-else",   "type": "simple",   "statement": "if?",              "code": null, "alternatives": ["a","b"],                             "correct": [0]},
    {"id": "q-bucles-1",     "document": "flujo",    "anchor": "bucles",    "type": "multiple", "statement": "¿Cuáles bucles?",  "code": null, "alternatives": ["for","while","hazlo","ninguno"],     "correct": [0,1]},
    {"id": "q-cortes-1",     "document": "flujo",    "anchor": "cortes",    "type": "simple",   "statement": "corte?",           "code": null, "alternatives": ["a","b"],                             "correct": [0]},
    {"id": "q-arr-basico-1", "document": "arreglos", "anchor": "basico",    "type": "simple",   "statement": "arr?",             "code": {"language": "java", "source": "int[] a = new int[3];"}, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q-arr-longitud-1","document": "arreglos","anchor": "longitud",  "type": "simple",   "statement": "longitud?",        "code": null, "alternatives": ["a.length","a.length()"],             "correct": [0]},
    {"id": "q-nuevo-1",      "document": "nuevo",    "anchor": "basico",    "type": "simple",   "statement": "nuevo?",           "code": null, "alternatives": ["a","b"],                             "correct": [0]}
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

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
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

// --- LiveBank / NewLive / Reload (issue #230, S1) -----------------------------

func TestNewLiveLoadsInitialBankFromFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "questions.json")
	if err := os.WriteFile(path, []byte(fixtureJSON), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	lb, err := bank.NewLive(context.Background(), "file://"+path, testLogger())
	if err != nil {
		t.Fatalf("NewLive(file): %v", err)
	}
	b := lb.Get()
	if b == nil {
		t.Fatal("Get() after NewLive returned nil")
	}
	if len(b.Documents) != 3 {
		t.Errorf("Get().Documents = %d, want 3", len(b.Documents))
	}
}

func TestNewLiveLoadsInitialBankFromHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
		_, _ = w.Write([]byte(fixtureJSON))
	}))
	t.Cleanup(srv.Close)

	lb, err := bank.NewLive(context.Background(), srv.URL+"/questions.json", testLogger())
	if err != nil {
		t.Fatalf("NewLive(http): %v", err)
	}
	if got := len(lb.Get().Documents); got != 3 {
		t.Errorf("Get().Documents = %d, want 3", got)
	}
}

func TestNewLiveRejectsUnsupportedScheme(t *testing.T) {
	_, err := bank.NewLive(context.Background(), "ftp://example.com/questions.json", testLogger())
	if !errors.Is(err, bank.ErrUnsupportedScheme) {
		t.Errorf("NewLive(ftp): %v, want ErrUnsupportedScheme", err)
	}
}

func TestNewLiveReportsHTTPNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "gone", http.StatusGone)
	}))
	t.Cleanup(srv.Close)

	_, err := bank.NewLive(context.Background(), srv.URL+"/questions.json", testLogger())
	if err == nil {
		t.Fatal("NewLive(410): no error")
	}
	if !strings.Contains(err.Error(), "410") {
		t.Errorf("error %q does not name status 410", err.Error())
	}
}

// TestReloadAtomicallySwapsWithoutInvalidatingPriorSnapshot is the whole point
// of atomic.Pointer: a reader holding a *Bank captured before Reload keeps
// seeing the old snapshot; a reader that calls Get() again after Reload sees
// the new one. Nothing in the middle observes a nil.
func TestReloadAtomicallySwapsWithoutInvalidatingPriorSnapshot(t *testing.T) {
	var body atomic.Pointer[string]
	initial := fixtureJSON
	body.Store(&initial)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
		_, _ = w.Write([]byte(*body.Load()))
	}))
	t.Cleanup(srv.Close)

	lb, err := bank.NewLive(context.Background(), srv.URL+"/questions.json", testLogger())
	if err != nil {
		t.Fatalf("NewLive: %v", err)
	}
	before := lb.Get()
	if len(before.Documents) != 3 {
		t.Fatalf("before.Documents = %d, want 3", len(before.Documents))
	}

	// The site publishes.
	extra := fixtureJSONExtra
	body.Store(&extra)

	updated, err := lb.Reload(context.Background())
	if err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if !updated {
		t.Errorf("Reload: updated=false, want true (the body changed)")
	}

	after := lb.Get()
	if len(after.Documents) != 4 {
		t.Errorf("after.Documents = %d, want 4 (Reload did not swap)", len(after.Documents))
	}

	// The pointer captured before Reload is UNCHANGED — atomic.Pointer stores
	// pointers, it does not mutate the underlying struct.
	if len(before.Documents) != 3 {
		t.Errorf("before.Documents mutated to %d — the swap must not touch a prior snapshot",
			len(before.Documents))
	}
	if before == after {
		t.Error("Get() returned the same pointer before and after Reload; the swap did not happen")
	}
}

// TestReloadIsNoOpOn304 covers the conditional-GET path: after a successful
// load the LiveBank remembers the Last-Modified header, and a subsequent
// Reload sends If-Modified-Since; when the server answers 304 the snapshot
// pointer is unchanged and Reload reports updated=false.
func TestReloadIsNoOpOn304(t *testing.T) {
	const lastMod = "Mon, 25 Aug 2026 12:00:00 GMT"
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("If-Modified-Since") != "" {
			// A conditional GET AFTER the initial load. Answer 304 to prove
			// the server can veto the parse without sending a body.
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Last-Modified", lastMod)
		_, _ = w.Write([]byte(fixtureJSON))
	}))
	t.Cleanup(srv.Close)

	lb, err := bank.NewLive(context.Background(), srv.URL+"/questions.json", testLogger())
	if err != nil {
		t.Fatalf("NewLive: %v", err)
	}
	before := lb.Get()

	updated, err := lb.Reload(context.Background())
	if err != nil {
		t.Fatalf("Reload(304): %v", err)
	}
	if updated {
		t.Errorf("Reload: updated=true on 304, want false")
	}
	if lb.Get() != before {
		t.Errorf("Get() pointer changed on 304 — the snapshot must survive a not-modified answer")
	}
	if calls.Load() != 2 {
		t.Errorf("server saw %d requests, want 2 (initial + conditional)", calls.Load())
	}
}

// TestReloadPreservesSnapshotOnServerError guards the escape-hatch promise: a
// GH Pages outage, a malformed response, a network flap — none may nil the
// snapshot. The server keeps serving the last known good bank.
func TestReloadPreservesSnapshotOnServerError(t *testing.T) {
	var down atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if down.Load() {
			http.Error(w, "gone", http.StatusGone)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fixtureJSON))
	}))
	t.Cleanup(srv.Close)

	lb, err := bank.NewLive(context.Background(), srv.URL+"/questions.json", testLogger())
	if err != nil {
		t.Fatalf("NewLive: %v", err)
	}
	before := lb.Get()

	down.Store(true)
	updated, err := lb.Reload(context.Background())
	if err == nil {
		t.Fatal("Reload(down): no error, want one")
	}
	if updated {
		t.Errorf("Reload(down): updated=true, want false")
	}
	if got := lb.Get(); got != before {
		t.Errorf("Get() after failed Reload returned a different pointer — the escape hatch nilled the snapshot")
	}
	if got := lb.Get(); got == nil || len(got.Documents) != 3 {
		t.Errorf("Get() after failed Reload = %v, want the boot snapshot", got)
	}
}

// TestReloadEmitsSlogInfoOnUpdate is the observability half of the promise:
// an operator reading logs sees which reload actually rotated the bank.
func TestReloadEmitsSlogInfoOnUpdate(t *testing.T) {
	var body atomic.Pointer[string]
	initial := fixtureJSON
	body.Store(&initial)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(*body.Load()))
	}))
	t.Cleanup(srv.Close)

	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))

	lb, err := bank.NewLive(context.Background(), srv.URL+"/questions.json", logger)
	if err != nil {
		t.Fatalf("NewLive: %v", err)
	}
	buf.Reset() // discard the boot log line

	extra := fixtureJSONExtra
	body.Store(&extra)
	if _, err := lb.Reload(context.Background()); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	got := buf.String()
	for _, want := range []string{`"level":"INFO"`, `"documents":4`, `"questions":9`, `bank refreshed`} {
		if !strings.Contains(got, want) {
			t.Errorf("info log missing %q\n---\n%s", want, got)
		}
	}
}

// TestStaticLiveExposesAFixedBank is the shim other packages' tests use to
// hand a bank into constructors that now take *LiveBank. Reload on a static
// bank is a no-op — the fixture never changes.
func TestStaticLiveExposesAFixedBank(t *testing.T) {
	b := parse(t)
	lb := bank.NewStaticLive(b)
	if lb.Get() != b {
		t.Error("StaticLive.Get() returned a different pointer than the one it was built from")
	}
	updated, err := lb.Reload(context.Background())
	if err != nil {
		t.Errorf("StaticLive.Reload: err = %v, want nil (static bank has no source)", err)
	}
	if updated {
		t.Error("StaticLive.Reload: updated=true, want false")
	}
	if lb.Get() != b {
		t.Error("StaticLive.Get() changed after Reload; a static bank never rotates")
	}
}
