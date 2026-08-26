package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
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
	// The production default (config default true, issue #190).
	return newControlsFixtureWith(t, true)
}

// newControlsFixtureWith builds the fixture with the annotate loop on or
// off — the AC-7 integration case needs the off side, which the shared
// helper never produces.
func newControlsFixtureWith(t *testing.T, annotateEnabled bool) *controlsFixture {
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
		Annotator: fake, AnnotateEnabled: annotateEnabled,
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

// Issue #208: the paper radio lives inside `<details> Opciones avanzadas`
// and Letter is checked by default. The pattern mirrors the DuplexPadding
// tests above: pin the paper input against name+checked (attribute-order
// agnostic) so a stray checked= elsewhere on the page cannot silently keep
// this test green. Two facts pinned in one test: the input exists, and
// Letter is the checked one.
var paperLetterCheckedRe = regexp.MustCompile(
	`<input[^>]*(?:name="paper"[^>]*\bvalue="letter"[^>]*\bchecked\b|\bchecked\b[^>]*name="paper"[^>]*\bvalue="letter"|value="letter"[^>]*name="paper"[^>]*\bchecked\b)[^>]*>`)

var paperA4CheckedRe = regexp.MustCompile(
	`<input[^>]*(?:name="paper"[^>]*\bvalue="a4"[^>]*\bchecked\b|\bchecked\b[^>]*name="paper"[^>]*\bvalue="a4"|value="a4"[^>]*name="paper"[^>]*\bchecked\b)[^>]*>`)

func TestNewRendersThePaperRadioWithLetterCheckedByDefault(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.New(rec, f.authedRequest(t, http.MethodGet, handler.ControlsNewPath, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	// Both radios must exist.
	if !strings.Contains(body, `name="paper"`) || !strings.Contains(body, `value="letter"`) {
		t.Error("form is missing the paper=letter radio")
	}
	if !strings.Contains(body, `value="a4"`) {
		t.Error("form is missing the paper=a4 radio")
	}
	// Letter is the default (ADR-0043).
	if !paperLetterCheckedRe.MatchString(body) {
		t.Errorf("the paper=letter radio is not `checked` on the empty GET form\nbody:\n%s", body)
	}
	// And A4 is NOT checked when Letter is — asserting the pair keeps a
	// mutation that checks both from passing.
	if paperA4CheckedRe.MatchString(body) {
		t.Error("the paper=a4 radio is `checked` when Letter should be the default")
	}
	// The radios live inside `<details>` so the default case shows no
	// friction (ADR-0043 §Decision).
	if !strings.Contains(body, `<details`) {
		t.Error("the paper radio is not inside a <details> block")
	}
}

func TestCreateStoresPaperLetterByDefault(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Del("paper") // simulate a submission with the `<details>` never opened
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
	rows, err := f.service.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("List returned %d rows, want 1", len(rows))
	}
	if rows[0].Paper != controls.PaperLetter {
		t.Errorf("stored Paper = %q, want %q (default when the form omits it)", rows[0].Paper, controls.PaperLetter)
	}
}

func TestCreateStoresPaperA4WhenTheRadioIsA4(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Set("paper", "a4")
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
	rows, err := f.service.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("List returned %d rows, want 1", len(rows))
	}
	if rows[0].Paper != controls.PaperA4 {
		t.Errorf("stored Paper = %q, want %q", rows[0].Paper, controls.PaperA4)
	}
}

// A form value outside {letter, a4} must be refused at 422, not silently
// coerced. The schema CHECK would refuse it too, but by then the disk-write
// side effects would have run and the error message would name a sqlite
// constraint (leak). The handler catches it first (Round A local review
// rationale: refuse where the meaning is known).
//
// Asserting the status alone was not enough — a mutation that removed the
// handler's ValidPaper check reddened this test at the status line too, but
// because a schema CHECK propagated as a 500 rather than because the handler
// refused with a 422. Asserting the field-error string in the body pins the
// layer this test claims to guard (Round A COR-4).
func TestCreateRefusesAnUnknownPaperValue(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Set("paper", "legal")
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 for paper='legal'; body:\n%s", rec.Code, rec.Body.String())
	}
	// The Spanish per-field error only appears on the handler's own 422
	// refusal path (validateCreate → render with errs). A schema CHECK
	// propagating as a 500 would render the generic server-error page
	// instead — which never contains this exact string. Also assert the
	// per-field error is scoped to `paper`, not any other field.
	body := rec.Body.String()
	if !strings.Contains(body, "El papel debe ser Letter o A4.") {
		t.Errorf("422 body is missing the handler's per-field message — the 422 may be coming from a lower gate; body:\n%s", body)
	}
}

// After a refusal, the paper the professor CHOSE stays selected on
// re-render — the same "echo back on refusal" convention every other
// field follows. Mirror of TestNewDoesNotRenderCheckedWhenTheForm
// ValueIsFalse for the checkbox.
func TestFormRefusalEchoesBackTheA4Choice(t *testing.T) {
	f := newControlsFixture(t)
	form := validForm()
	form.Set("paper", "a4")
	form.Del("name") // force a refusal
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, form))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body:\n%s", rec.Code, rec.Body.String())
	}
	if !paperA4CheckedRe.MatchString(rec.Body.String()) {
		t.Error("re-rendered form does not carry `checked` on paper=a4 after the professor chose it")
	}
	if paperLetterCheckedRe.MatchString(rec.Body.String()) {
		t.Error("re-rendered form still carries `checked` on paper=letter after the professor picked a4")
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

// TestNewFormCarriesTheCascadePickerMarkers pins the S4 progressive
// enhancement: the flat select is annotated with the data-cascade attribute
// (so the inline script finds it) and the script itself is inlined on the
// page. The flat <select> still carries every (doc, section) option — the
// case above asserts that, and it is what continues to submit when JS is
// off.
//
// A tighter DOM test (asserting the cascade renders and cascades correctly)
// belongs in a browser, not here: this file is a Go test and cannot execute
// the script. The DOM behavior is verified by the manual check.
func TestNewFormCarriesTheCascadePickerMarkers(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.New(rec, f.authedRequest(t, http.MethodGet, handler.ControlsNewPath, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	// Each check is one intent; the whitespace of the template is NOT
	// part of the assertion, so a reformat of the HTML leaves the case
	// green (S3 review ARQ-4). The initial revision baked the 14-space
	// indent of the `data-cascade` line into the substring and would have
	// broken on any indent change.
	for _, needle := range []string{
		`id="from"`,
		`id="to"`,
		`name="from"`,
		`name="to"`,
		`data-cascade`,
		`data-cascade-doc-label`,
		// The script that builds the cascade — a stable-looking selector
		// substring, not a whole-block match.
		`select[data-cascade]`,
	} {
		if !strings.Contains(body, needle) {
			t.Errorf("form is missing cascade marker %q", needle)
		}
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
	for _, want := range []string{"Control 1", "Descargar prueba", "Descargar clave", "Descargar respaldo", "Aún no hay escaneos"} {
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

func TestPoolJSONStreamsTheSnapshot(t *testing.T) {
	f := newControlsFixture(t)
	rec := httptest.NewRecorder()
	f.handler.Create(rec, f.authedRequest(t, http.MethodPost, handler.ControlsPath, validForm()))
	loc := rec.Header().Get("Location")
	id := strings.TrimPrefix(loc, handler.ControlsPath+"/")

	rec = httptest.NewRecorder()
	req := f.authedRequest(t, http.MethodGet, loc+"/pool.json", nil)
	req.SetPathValue("id", id)
	f.handler.PoolJSON(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("PoolJSON status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "attachment") {
		t.Errorf("Content-Disposition = %q, want attachment (backup material, not a page)", cd)
	}
	// The body is the snapshot Create wrote — parse it back and check the
	// control's id arrived.
	var snap controls.PoolSnapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("pool.json body does not parse: %v", err)
	}
	if snap.Control.ID != id {
		t.Errorf("pool.json control id = %q, want %q", snap.Control.ID, id)
	}
	if len(snap.Pool) == 0 {
		t.Error("pool.json pool is empty")
	}
}

func TestPoolJSON404sWhenTheControlIsUnknown(t *testing.T) {
	f := newControlsFixture(t)

	rec := httptest.NewRecorder()
	req := f.authedRequest(t, http.MethodGet, "/controls/AAAAAAAAAAAAAAAAAAAAAAAAAA/pool.json", nil)
	req.SetPathValue("id", "AAAAAAAAAAAAAAAAAAAAAAAAAA")
	f.handler.PoolJSON(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status(well-shaped unknown) = %d, want 404", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = f.authedRequest(t, http.MethodGet, "/controls/short/pool.json", nil)
	req.SetPathValue("id", "short")
	f.handler.PoolJSON(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status(bad shape) = %d, want 404", rec.Code)
	}
}
