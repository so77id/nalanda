package amcworker_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker"
)

// Issue #310 S4: a survey run's sheet goes through the same /generate and
// comes back in the SURVEY domain's types and sentinels — never the
// controls' (ADR-0078).

func TestGenerateSheetSpeaksTheSurveyDomain(t *testing.T) {
	var got struct {
		Project string `json:"project"`
		Source  string `json:"source"`
		Copies  int    `json:"copies"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/generate" {
			t.Errorf("worker got %s, want /generate", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		respond(w, http.StatusOK, map[string]any{
			"sujet": "surveys/3/runs/7/out/sujet.pdf", "corrige": "surveys/3/runs/7/out/corrige.pdf",
			"calage": "surveys/3/runs/7/out/calage.xy", "copies": 45,
		})
	}))
	t.Cleanup(srv.Close)

	assets, err := amcworker.New(amcworker.Config{BaseURL: srv.URL}).GenerateSheet(context.Background(),
		survey.GenerateRequest{Project: "surveys/3/runs/7", Source: "surveys/3/runs/7/inputs/source.tex", Copies: 45})
	if err != nil {
		t.Fatalf("GenerateSheet: %v", err)
	}
	if got.Project != "surveys/3/runs/7" || got.Copies != 45 || assets.Sujet != "surveys/3/runs/7/out/sujet.pdf" {
		t.Errorf("sent %+v, got %+v", got, assets)
	}
}

func TestGenerateSheetFailuresAreSurveySentinels(t *testing.T) {
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusBadRequest, map[string]any{"error": "auto-multiple-choice prepare failed (1)", "detail": "ERR: …"})
	}))
	t.Cleanup(refusing.Close)
	req := survey.GenerateRequest{Project: "surveys/3/runs/7", Source: "surveys/3/runs/7/inputs/source.tex", Copies: 2}

	_, err := amcworker.New(amcworker.Config{BaseURL: refusing.URL}).GenerateSheet(context.Background(), req)
	if !errors.Is(err, survey.ErrGeneratorRefused) || errors.Is(err, controls.ErrGeneratorRefused) {
		t.Errorf("a refusal: %v, want survey.ErrGeneratorRefused and not the controls' one", err)
	}

	dead, err := listenerThatRefuses(t)
	if err != nil {
		t.Fatalf("listener: %v", err)
	}
	_, err = amcworker.New(amcworker.Config{BaseURL: "http://" + dead}).GenerateSheet(context.Background(), req)
	if !errors.Is(err, survey.ErrGeneratorUnavailable) {
		t.Errorf("a dead worker: %v, want survey.ErrGeneratorUnavailable", err)
	}

	_, err = amcworker.New(amcworker.Config{BaseURL: refusing.URL}).GenerateSheet(context.Background(),
		survey.GenerateRequest{Project: "p", Source: "s", Copies: 0})
	if !errors.Is(err, survey.ErrGeneratorRefused) {
		t.Errorf("zero copies: %v, want survey.ErrGeneratorRefused before any call", err)
	}
}

// Issue #311 S2: the S0 report — a real /analyse of a survey sheet, kept
// by 08-survey.sh — read through the survey port and then mapped onto a
// bank shaped like the S0 one. The copy-level status (every copy
// needs_review, every RUT unreadable) must not leak into anything.
func TestAnalyzeSheetsReadsTheS0ReportInSurveyTerms(t *testing.T) {
	fixture, err := os.ReadFile("testdata/survey-report.json")
	if err != nil {
		t.Fatal(err)
	}
	var sent map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/analyse" {
			t.Errorf("worker got %s, want /analyse", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&sent)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(fixture)
	}))
	t.Cleanup(srv.Close)

	report, err := amcworker.New(amcworker.Config{BaseURL: srv.URL}).AnalyzeSheets(context.Background(), survey.AnalyzeRequest{
		Project: "surveys/3/runs/7", ScanPDF: "surveys/3/runs/7/uploads/batch-1.pdf",
		Source: "surveys/3/runs/7/inputs/source.tex", Ticked: survey.DefaultTicked, Unsure: survey.DefaultUnsure,
	})
	if err != nil {
		t.Fatalf("AnalyzeSheets: %v", err)
	}
	if sent["scan_pdf"] != "surveys/3/runs/7/uploads/batch-1.pdf" || sent["ticked"] != survey.DefaultTicked {
		t.Errorf("sent %v", sent)
	}
	if report.Batch.Captured != 3 || len(report.Copies) != 3 {
		t.Fatalf("report = %+v", report)
	}

	bank := func(id int64, kind survey.QuestionKind, n int) survey.Question {
		q := survey.Question{ID: id, Kind: kind}
		for p := 1; p <= n; p++ {
			q.Alternatives = append(q.Alternatives, survey.Alternative{ID: id*10 + int64(p), Position: p})
		}
		return q
	}
	readings, err := survey.ReadReport(report, []survey.Question{
		bank(1, survey.KindSingle, 3), bank(2, survey.KindScale, 5), bank(3, survey.KindMulti, 4), bank(4, survey.KindSingle, 4),
	})
	if err != nil {
		t.Fatalf("ReadReport: %v", err)
	}
	m := func(q, a int64) survey.Mark { return survey.Mark{QuestionID: q, AlternativeID: a} }
	want := []survey.CopyReading{
		{CopyNumber: 1, Pages: []int{1}, Marks: []survey.Mark{m(1, 11), m(2, 23), m(3, 31), m(3, 33), m(4, 42)}},
		{CopyNumber: 2, Pages: []int{1}, Marks: []survey.Mark{m(4, 41)}, Items: []survey.ReviewItemDraft{
			{QuestionID: 1, Reason: survey.ReasonAmbiguous, Marked: []int64{11, 12}},
			{QuestionID: 2, Reason: survey.ReasonDoubtful, Doubtful: []int64{24}},
		}},
		{CopyNumber: 3, Pages: []int{1}, Marks: []survey.Mark{m(1, 13), m(3, 31), m(3, 32), m(3, 33), m(3, 34)}, Items: []survey.ReviewItemDraft{
			{QuestionID: 2, Reason: survey.ReasonAmbiguous, Marked: []int64{22, 24}},
		}},
	}
	if !reflect.DeepEqual(readings, want) {
		t.Errorf("readings =\n%+v\nwant\n%+v", readings, want)
	}
}

func TestAnalyzeSheetsFailuresAreSurveySentinels(t *testing.T) {
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusUnprocessableEntity, map[string]any{"error": "auto-multiple-choice analyse failed (1)", "detail": "…"})
	}))
	t.Cleanup(refusing.Close)
	req := survey.AnalyzeRequest{Project: "p", ScanPDF: "p/uploads/batch-1.pdf", Source: "p/inputs/source.tex",
		Ticked: survey.DefaultTicked, Unsure: survey.DefaultUnsure}

	_, err := amcworker.New(amcworker.Config{BaseURL: refusing.URL}).AnalyzeSheets(context.Background(), req)
	if !errors.Is(err, survey.ErrAnalyzerRefused) || errors.Is(err, controls.ErrAnalyzerRefused) {
		t.Errorf("a refusal: %v, want survey.ErrAnalyzerRefused and not the controls' one", err)
	}
	_, err = amcworker.New(amcworker.Config{BaseURL: "http://127.0.0.1:1"}).AnalyzeSheets(context.Background(), req)
	if !errors.Is(err, survey.ErrAnalyzerUnavailable) {
		t.Errorf("an unreachable worker: %v, want survey.ErrAnalyzerUnavailable", err)
	}
	if _, err := amcworker.New(amcworker.Config{BaseURL: refusing.URL}).AnalyzeSheets(context.Background(), survey.AnalyzeRequest{}); !errors.Is(err, survey.ErrAnalyzerRefused) {
		t.Errorf("an empty request: %v, want survey.ErrAnalyzerRefused before the wire", err)
	}
}

// Issue #311 S6: the survey's reset speaks survey sentinels, and a busy
// worker refuses at once.
func TestResetSurveyScansSpeaksTheSurveyDomain(t *testing.T) {
	var got map[string]string
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/scans/reset" {
			t.Errorf("worker got %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		respond(w, http.StatusOK, map[string]any{"reset": true})
	}))
	t.Cleanup(ok.Close)
	if err := amcworker.New(amcworker.Config{BaseURL: ok.URL}).ResetSurveyScans(context.Background(), "surveys/3/runs/7"); err != nil ||
		got["project"] != "surveys/3/runs/7" {
		t.Errorf("reset: %v, sent %v", err, got)
	}

	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusNotFound, map[string]any{"error": "no such route"})
	}))
	t.Cleanup(refusing.Close)
	err := amcworker.New(amcworker.Config{BaseURL: refusing.URL}).ResetSurveyScans(context.Background(), "surveys/3/runs/7")
	if !errors.Is(err, survey.ErrAnalyzerRefused) || errors.Is(err, controls.ErrAnalyzerRefused) {
		t.Errorf("a worker that predates the route: %v, want survey.ErrAnalyzerRefused", err)
	}
}
