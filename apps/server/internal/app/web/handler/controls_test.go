package handler_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker/amctest"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/controlstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

const controlsBankJSON = `{
  "version": 1,
  "documents": [
    {"id": "welcome", "title": "Bienvenida", "coverage": "clase 0",
     "sections": ["hola", "reglas"]},
    {"id": "flujo",   "title": "Flujo",      "coverage": "clase 2",
     "sections": ["if-else", "bucles"]}
  ],
  "questions": [
    {"id": "q1", "document": "welcome", "anchor": "hola",   "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q2", "document": "welcome", "anchor": "reglas", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q3", "document": "flujo",   "anchor": "if-else","type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q4", "document": "flujo",   "anchor": "bucles", "type": "multiple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]}
  ]
}`

type controlsFixture struct {
	handler *handler.Controls
	service *controls.Service
	// cstore is the real controlstore behind the service — tests that need
	// to read rows back (annotated_copy since issue #190) query it instead
	// of re-deriving the database path.
	cstore  *controlstore.Store
	fake    *amctest.Fake
	hook    *recordingHook
	workDir string
	user    auth.User
	session auth.Session
	log     *slog.Logger
}

// recordingHook is the test double for controls.OnCorrectionClosed: it
// records every Closed call and captures the control's state AT THE MOMENT
// the hook ran, which is what pins the "state=graded, then hook" order.
type recordingHook struct {
	calls   []string
	service *controls.Service
}

func (h *recordingHook) Closed(ctx context.Context, controlID string) error {
	h.calls = append(h.calls, controlID)
	if c, err := h.service.Get(ctx, controlID); err == nil {
		h.calls = append(h.calls, string(c.State))
	}
	return nil
}

func newControlsFixture(t *testing.T) *controlsFixture {
	t.Helper()
	ctx := context.Background()

	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	authStore := authstore.New(db)
	prof, err := authStore.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	session := auth.Session{
		TokenHash: "hash-1",
		UserID:    prof.ID,
		CSRFToken: "csrf-1",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := authStore.CreateSession(ctx, session); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	b, err := bank.Parse(strings.NewReader(controlsBankJSON))
	if err != nil {
		t.Fatalf("bank.Parse: %v", err)
	}
	workDir := t.TempDir()
	fake := &amctest.Fake{WorkDir: workDir, SujetSize: 42}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	cstore := controlstore.New(db)
	svc := controls.NewService(controls.Service{
		Bank: b, Store: cstore, Generator: fake, Analyzer: fake, Readings: cstore,
		Annotator: fake, AnnotateEnabled: true,
		WorkDir: workDir,
		Now:     time.Now, Seed: 1, Log: log,
	})
	hook := &recordingHook{service: svc}
	h := handler.NewControls(handler.Controls{
		Service: svc, Bank: b,
		PublicURL: publicURL, MaxScanBytes: 5 << 20,
		OnCorrectionClosed: hook,
		Log:                log,
	})
	return &controlsFixture{handler: h, service: svc, cstore: cstore, fake: fake, hook: hook, workDir: workDir, user: prof, session: session, log: log}
}

func (f *controlsFixture) authedRequest(t *testing.T, method, path string, body url.Values) *http.Request {
	t.Helper()
	var req *http.Request
	if body != nil {
		req = httptest.NewRequest(method, path, strings.NewReader(body.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	ctx := middleware.WithProfessorForTest(req.Context(), f.user, f.session)
	return req.WithContext(ctx)
}

func validForm() url.Values {
	return url.Values{
		"name":               {"Control 1"},
		"application_date":   {"2026-08-25"},
		"from":               {"welcome:hola"},
		"to":                 {"flujo:bucles"},
		"questions_per_copy": {"3"},
		"copies":             {"2"},
		// The form's default checkbox state is checked (padded, the
		// historical layout), so a POST that mirrors the rendered form
		// carries this value. An unchecked checkbox sends nothing —
		// TestCreateStoresDuplexPaddingFalseWhenTheCheckboxIsUnchecked
		// covers that.
		"duplex_padding": {"on"},
		"csrf_token":     {"csrf-1"},
	}
}

// Issue #185: the form carries a duplex-padding checkbox, checked by
// default so the historical layout requires no action. Unchecking it means
// simplex printing: no blank filler page between prints.
//
// Pinned against the duplex_padding INPUT (attribute-order agnostic) rather
// than a stray "checked" anywhere in the page, so a second checkbox or a
// class="check-something" would not silently keep this test green
// (Round A local-review, item 1).
var duplexPaddingCheckedRe = regexp.MustCompile(
	`<input[^>]*(?:name="duplex_padding"[^>]*\bchecked\b|\bchecked\b[^>]*name="duplex_padding")[^>]*>`)

func TestNewRendersTheDuplexPaddingCheckboxCheckedByDefault(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.New(rec, f.authedRequest(t, http.MethodGet, handler.ControlsNewPath, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `name="duplex_padding"`) {
		t.Error("form is missing the duplex_padding checkbox")
	}
	if !strings.Contains(body, `type="checkbox"`) {
		t.Error("duplex_padding is not a checkbox input")
	}
	if !duplexPaddingCheckedRe.MatchString(body) {
		t.Errorf("the duplex_padding <input> is not `checked` on the empty GET form\nbody:\n%s", body)
	}
}

func TestCreateStoresDuplexPaddingTrueWhenTheCheckboxIsOn(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, validForm()))

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
	rows, err := f.service.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 1 || !rows[0].DuplexPadding {
		t.Errorf("stored DuplexPadding = false, want true (form sent duplex_padding=on)")
	}
}

// The negative-render case: DuplexPadding = false in the form values must
// produce an <input> WITHOUT the `checked` attribute, else a refusal that
// preserves the professor's unchecked state silently returns to padded on
// re-render.
func TestNewDoesNotRenderCheckedWhenTheFormValueIsFalse(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Del("duplex_padding")
	form.Del("name") // force a refusal so the same form is re-rendered
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (form refusal); body:\n%s", rec.Code, rec.Body.String())
	}
	if duplexPaddingCheckedRe.MatchString(rec.Body.String()) {
		t.Error("re-rendered form carries `checked` on duplex_padding after the professor unchecked it")
	}
}

func TestCreateStoresDuplexPaddingFalseWhenTheCheckboxIsUnchecked(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Del("duplex_padding") // HTML omits unchecked checkboxes entirely
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
	rows, err := f.service.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 1 || rows[0].DuplexPadding {
		t.Errorf("stored DuplexPadding = true, want false (form omitted the checkbox)")
	}
}

func TestNewRendersTheFormWithBankSections(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.New(rec, f.authedRequest(t, http.MethodGet, handler.ControlsNewPath, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	// The form's dropdowns must carry every (doc, section) as an option
	// value "doc:section".
	for _, opt := range []string{`value="welcome:hola"`, `value="flujo:bucles"`, `<optgroup label="Bienvenida">`} {
		if !strings.Contains(body, opt) {
			t.Errorf("form is missing %q", opt)
		}
	}
	if !strings.Contains(body, `name="csrf_token" value="csrf-1"`) {
		t.Error("form is missing the CSRF token")
	}
}

func TestCreateWritesAControlAndRedirectsToItsDetail(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, validForm()))

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	if !strings.HasPrefix(loc, handler.ControlsPath+"/") {
		t.Errorf("Location = %q, want /controls/<id>", loc)
	}

	rows, err := f.service.List(context.Background())
	if err != nil {
		t.Fatalf("ListControls: %v", err)
	}
	if len(rows) != 1 || rows[0].CreatedBy != f.user.ID {
		t.Errorf("stored rows = %+v (created_by must be the acting professor)", rows)
	}
	if rows[0].State != controls.Generated {
		t.Errorf("state = %v, want %v", rows[0].State, controls.Generated)
	}

	// The flash cookie was set — a caller landing on the detail page
	// would see it once.
	if cookie := rec.Header().Get("Set-Cookie"); !strings.Contains(cookie, "nalanda_flash") {
		t.Errorf("no flash cookie set, want one (POST/redirect/GET convention)")
	}

	// sujet.pdf is on disk.
	if _, err := os.Stat(filepath.Join(f.workDir, "controls", rows[0].ID, "out", "sujet.pdf")); err != nil {
		t.Errorf("sujet.pdf missing on disk: %v", err)
	}
}

func TestCreateRefusesMissingNameWith422(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Del("name")
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "obligatorio") {
		t.Error("body does not carry the 'obligatorio' error for the name field")
	}
	// A refusal does NOT redirect — asserting the status code covers this
	// with the location check.
	if rec.Header().Get("Location") != "" {
		t.Error("a 422 refusal must not carry a Location header")
	}
	// The store is untouched.
	rows, _ := f.service.List(context.Background())
	if len(rows) != 0 {
		t.Errorf("stored %d rows after a refusal, want 0", len(rows))
	}
}

func TestCreateRefusesAnUnknownRangeWith422(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Set("from", "no-such-doc:no-such-section")
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "no existe") {
		t.Error("body does not carry the 'no existe' error for the from field")
	}
}

func TestCreateRefusesAPoolTooSmallForCopyWithSpanishNumbers(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Set("from", "welcome:hola")
	form.Set("to", "welcome:hola")      // one question in the range
	form.Set("questions_per_copy", "3") // ask for 3
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body:\n%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	// The Spanish message names BOTH counts (issue #166 §The form:
	// "Pediste 8 preguntas por copia, pero el rango solo tiene 5
	// disponibles").
	for _, want := range []string{"3 preguntas", "1 disponibles"} {
		if !strings.Contains(body, want) {
			t.Errorf("body does not carry %q; got:\n%s", want, body)
		}
	}
}

func TestCreateRefusesInvertedRangeWith422(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Set("from", "flujo:bucles")
	form.Set("to", "welcome:hola")
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "antes que el inicio") {
		t.Error("body does not name the inverted-range refusal")
	}
}

func TestCreateRefusesInvalidDateWith422(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Set("application_date", "August 25")
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "AAAA-MM-DD") {
		t.Error("body does not carry the date-format error")
	}
}

// Values the user typed come back on refusal (issue #151 §Form:
// "The values the professor typed come back on refusal").
func TestCreateEchoesValuesOnRefusal(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Set("name", "") // trigger refusal on the name field
	form.Set("application_date", "2026-09-05")
	form.Set("copies", "17")
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	body := rec.Body.String()
	if !strings.Contains(body, `value="2026-09-05"`) {
		t.Error("body did not echo the application_date value")
	}
	if !strings.Contains(body, `value="17"`) {
		t.Error("body did not echo the copies value")
	}
}

func TestCreateRendersA500ThroughTheShellWhenTheWorkerRefuses(t *testing.T) {
	f := newControlsFixture(t)
	f.fake.Err = controls.ErrGeneratorRefused

	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, validForm()))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (worker failure is not a form error)", rec.Code)
	}
	// The shell error page renders through view.RenderError — its
	// Spanish message is what the professor reads.
	if !strings.Contains(rec.Body.String(), "servidor") {
		t.Error("body does not carry the shell error page's Spanish message")
	}

	rows, _ := f.service.List(context.Background())
	if len(rows) != 0 {
		t.Errorf("stored %d rows after a worker failure, want 0 (creation is all-or-nothing)", len(rows))
	}
}

func TestCreateRendersA500WhenSujetIsMissing(t *testing.T) {
	f := newControlsFixture(t)
	f.fake.SujetSize = 0 // fake writes a 0-byte sujet.pdf

	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, validForm()))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	rows, _ := f.service.List(context.Background())
	if len(rows) != 0 {
		t.Errorf("stored %d rows after a 0-byte sujet, want 0", len(rows))
	}
}

func TestListRendersEveryControl(t *testing.T) {
	f := newControlsFixture(t)
	// Land one control.
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, validForm()))
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("Create failed setting up: %d — %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	f.handler.List(rec, f.authedRequest(t, http.MethodGet, handler.ControlsPath, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("List status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{"Control 1", "3 preguntas × 2 copias", "Generado", "Bienvenida / hola → Flujo / bucles"} {
		if !strings.Contains(body, want) {
			t.Errorf("list body missing %q", want)
		}
	}
}

func TestRootRedirectsToControls(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.Root(rec, f.authedRequest(t, http.MethodGet, "/", nil))
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != handler.ControlsPath {
		t.Errorf("Location = %q, want %q", loc, handler.ControlsPath)
	}
}

func TestDetailReturnsA404OnAnUnknownID(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	// A well-shaped id (26 chars, valid alphabet) that does not exist.
	req := f.authedRequest(t, http.MethodGet, "/controls/AAAAAAAAAAAAAAAAAAAAAAAAAA", nil)
	req.SetPathValue("id", "AAAAAAAAAAAAAAAAAAAAAAAAAA")
	f.handler.Detail(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (well-shaped but unknown id)", rec.Code)
	}

	// A badly-shaped id (wrong length) also 404s, before the store lookup.
	rec = httptest.NewRecorder()
	req = f.authedRequest(t, http.MethodGet, "/controls/short", nil)
	req.SetPathValue("id", "short")
	f.handler.Detail(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (bad shape)", rec.Code)
	}
}

func TestDetailRendersMetadataAndDownloadLinks(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, validForm()))
	loc := rec.Header().Get("Location")
	id := strings.TrimPrefix(loc, handler.ControlsPath+"/")

	rec = httptest.NewRecorder()
	req := f.authedRequest(t, http.MethodGet, loc, nil)
	req.SetPathValue("id", id)
	f.handler.Detail(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Detail status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{"Control 1", "Descargar prueba", "Descargar clave", "Aún no hay escaneos"} {
		if !strings.Contains(body, want) {
			t.Errorf("detail body missing %q", want)
		}
	}
	// Issue #185: the detail page surfaces the print layout so the professor
	// can tell duplex-padded controls from simplex ones without opening the
	// PDF. validForm() sends duplex_padding=on, so this control is padded.
	if !strings.Contains(body, "dúplex") {
		t.Errorf("detail body missing the print-layout row (\"dúplex\")")
	}
}

func TestSujetPDFStreamsTheFile(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, validForm()))
	loc := rec.Header().Get("Location")
	id := strings.TrimPrefix(loc, handler.ControlsPath+"/")

	rec = httptest.NewRecorder()
	req := f.authedRequest(t, http.MethodGet, loc+"/sujet.pdf", nil)
	req.SetPathValue("id", id)
	f.handler.SujetPDF(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("SujetPDF status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q, want application/pdf", ct)
	}
	if got, want := rec.Body.Bytes(), bytes.Repeat([]byte{0}, 42); !bytes.Equal(got, want) {
		t.Errorf("body len = %d, want 42 (amctest.Fake wrote 42 zero bytes as the stub)", len(got))
	}
}

func TestSujetPDF404sWhenTheControlIsUnknown(t *testing.T) {
	f := newControlsFixture(t)

	// Well-shaped but unknown id — the store's lookup misses.
	rec := httptest.NewRecorder()
	req := f.authedRequest(t, http.MethodGet, "/controls/AAAAAAAAAAAAAAAAAAAAAAAAAA/sujet.pdf", nil)
	req.SetPathValue("id", "AAAAAAAAAAAAAAAAAAAAAAAAAA")
	f.handler.SujetPDF(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status(well-shaped unknown) = %d, want 404", rec.Code)
	}

	// Badly-shaped id — the isValidControlID guard rejects before the
	// store is even reached. Covers the fast-fail path Detail also has.
	rec = httptest.NewRecorder()
	req = f.authedRequest(t, http.MethodGet, "/controls/short/sujet.pdf", nil)
	req.SetPathValue("id", "short")
	f.handler.SujetPDF(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status(bad shape) = %d, want 404", rec.Code)
	}
}
