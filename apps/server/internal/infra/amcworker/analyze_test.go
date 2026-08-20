package amcworker_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker"
)

// sampleReport is what a healthy /analyse response looks like — modelled on
// read_capture.py's own docstring. Kept small (one copy) so an assertion on
// the decoded shape stays legible.
const sampleReport = `{
  "pages": {"captured": 4, "failed": 0},
  "scoring": {"seuil": 0.3, "ticked": 0.3, "stale": false},
  "copies": {
    "1": {
      "rut": "20123456",
      "rut_status": "ok",
      "rut_columns": [{"column": 0, "digits": ["2"]}],
      "answers": [
        {"question": 9, "name": "q-if-1", "type": "simple",
         "marked": [1], "doubtful": [], "status": "ok",
         "score": 1.0, "max": 1.0},
        {"question": 10, "name": "q-bucles-2", "type": "multiple",
         "marked": [1, 3], "doubtful": [{"answer": 2, "darkness": 0.18}],
         "status": "doubtful",
         "score": 3.0, "max": 4.0}
      ],
      "expected_questions": 2,
      "seen_questions": 2,
      "missing_questions": [],
      "status": "needs_review"
    }
  },
  "needs_review": ["1"]
}`

func TestAnalyzeSendsProjectScanPDFAndSource(t *testing.T) {
	var got analyzeSent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/analyse" {
			t.Errorf("worker got %s %s, want POST /analyse", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(sampleReport))
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	report, err := client.Analyze(context.Background(), controls.AnalyzeRequest{
		Project: "controls/abc",
		ScanPDF: "controls/abc/scans/batch-1.pdf",
		Source:  "controls/abc/inputs/source.tex",
		Ticked:  controls.DefaultTicked,
		Unsure:  controls.DefaultUnsure,
	})
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if got.Project != "controls/abc" || got.ScanPDF != "controls/abc/scans/batch-1.pdf" ||
		got.Source != "controls/abc/inputs/source.tex" {
		t.Errorf("worker received %+v", got)
	}
	// Issue #197: the pair travels on the wire, not only through validation.
	if got.Ticked != controls.DefaultTicked || got.Unsure != controls.DefaultUnsure {
		t.Errorf("worker received thresholds (%v, %v), want the defaults",
			got.Ticked, got.Unsure)
	}

	// unsure=0 is a legal pair (no doubtful band) and must reach the wire
	// as 0 — an omitempty tag dropped it once, and the worker then silently
	// read its own 0.05 default.
	if _, err := client.Analyze(context.Background(), controls.AnalyzeRequest{
		Project: "controls/abc", ScanPDF: "controls/abc/scans/batch-1.pdf",
		Source: "controls/abc/inputs/source.tex",
		Ticked: 0.30, Unsure: 0,
	}); err != nil {
		t.Fatalf("Analyze with unsure=0: %v", err)
	}
	if got.Unsure != 0 {
		t.Errorf("worker received unsure %v, want the explicit 0", got.Unsure)
	}
	// The report round-trips into the domain shape.
	if report.Pages.Captured != 4 || len(report.Copies) != 1 {
		t.Errorf("Report = %+v", report)
	}
	copy1 := report.Copies["1"]
	if copy1.RUTStatus != controls.RUTStatusOK || copy1.Status != controls.CopyStatusNeedsReview {
		t.Errorf("Copy1 = %+v", copy1)
	}
	if len(copy1.Answers) != 2 || copy1.Answers[0].Type != controls.QuestionSimple ||
		copy1.Answers[1].Type != controls.QuestionMultiple {
		t.Errorf("answers = %+v", copy1.Answers)
	}
	if copy1.Answers[1].Doubtful[0].Darkness != 0.18 {
		t.Errorf("doubtful darkness = %v", copy1.Answers[1].Doubtful[0].Darkness)
	}
}

func TestAnalyzeRefusedOn4xxWrapsErrAnalyzerRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"the batch was scored before it was fully captured","detail":"copy 6 question 'p2' has no score"}`))
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Analyze(context.Background(), controls.AnalyzeRequest{
		Project: "controls/x", ScanPDF: "controls/x/s.pdf", Source: "controls/x/s.tex",
		Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure,
	})
	if !errors.Is(err, controls.ErrAnalyzerRefused) {
		t.Errorf("Analyze on 400: %v, want ErrAnalyzerRefused", err)
	}
	if !strings.Contains(err.Error(), "scored before it was fully captured") {
		t.Errorf("error %q does not include worker's message", err.Error())
	}
}

// Issue #210: a refused analyse (or reanalyse) reaches the caller as a
// typed *AnalyzerRefusedError that carries the worker's Message and Detail
// verbatim. errors.Is on the sentinel still matches — the type wraps it.
// Callers rendering the failure (log, flash) read Detail without parsing
// the error string.
func TestAnalyzeRefusalCarriesWorkerMessageAndDetail(t *testing.T) {
	body := `{"error":"scan not recognized","detail":"ERR: /work/x/scans/a not recognized\nERR: /work/x/scans/b not recognized"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Analyze(context.Background(), controls.AnalyzeRequest{
		Project: "controls/x", ScanPDF: "controls/x/s.pdf", Source: "controls/x/s.tex",
		Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure,
	})
	if !errors.Is(err, controls.ErrAnalyzerRefused) {
		t.Fatalf("Analyze: %v; want wrapping ErrAnalyzerRefused", err)
	}
	var wrapped *controls.AnalyzerRefusedError
	if !errors.As(err, &wrapped) {
		t.Fatalf("Analyze: %v; want *AnalyzerRefusedError via errors.As", err)
	}
	if !strings.Contains(wrapped.Message, "scan not recognized") {
		t.Errorf("Message = %q; must include the worker's error text", wrapped.Message)
	}
	if wrapped.Detail != "ERR: /work/x/scans/a not recognized\nERR: /work/x/scans/b not recognized" {
		t.Errorf("Detail = %q; want the raw stderr excerpt", wrapped.Detail)
	}
}

// Reanalyze shares postReport with Analyze, but a future refactor could
// split them; this pins the guarantee at both entry points.
func TestReanalyzeRefusalCarriesWorkerMessageAndDetail(t *testing.T) {
	body := `{"error":"no captures","detail":"nothing to re-read"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Reanalyze(context.Background(), controls.ReanalyzeRequest{
		Project: "controls/x", Ticked: 0.3, Unsure: 0.15,
	})
	var wrapped *controls.AnalyzerRefusedError
	if !errors.As(err, &wrapped) {
		t.Fatalf("Reanalyze: %v; want *AnalyzerRefusedError via errors.As", err)
	}
	if wrapped.Detail != "nothing to re-read" {
		t.Errorf("Detail = %q; want %q", wrapped.Detail, "nothing to re-read")
	}
}

func TestAnalyzeRefusesInvalidRequestBeforeCallingTheWorker(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatal("Analyze reached the worker with an invalid request")
	}))
	t.Cleanup(srv.Close)
	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})

	cases := []controls.AnalyzeRequest{
		{Project: "", ScanPDF: "s", Source: "t",
			Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure},
		{Project: "p", ScanPDF: "", Source: "t",
			Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure},
		{Project: "p", ScanPDF: "s", Source: "",
			Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure},
		// Issue #197: the band rule is refused before the wire.
		{Project: "p", ScanPDF: "s", Source: "t", Ticked: 0.05, Unsure: 0.20},
	}
	for _, req := range cases {
		if _, err := client.Analyze(context.Background(), req); !errors.Is(err, controls.ErrAnalyzerRefused) {
			t.Errorf("Analyze(%+v): %v, want ErrAnalyzerRefused", req, err)
		}
	}
}

func TestReanalyzeSendsProjectAndThresholds(t *testing.T) {
	var got reanalyzeSent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/reanalyse" {
			t.Errorf("worker got %s %s, want POST /reanalyse", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(sampleReport))
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Reanalyze(context.Background(), controls.ReanalyzeRequest{
		Project: "controls/abc", Ticked: 0.25, Unsure: 0.12,
	})
	if err != nil {
		t.Fatalf("Reanalyze: %v", err)
	}
	if got.Project != "controls/abc" || got.Ticked != 0.25 || got.Unsure != 0.12 {
		t.Errorf("worker received %+v", got)
	}
}

func TestReanalyzeRefusesOutOfRangeThresholds(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatal("Reanalyze reached the worker with invalid thresholds")
	}))
	t.Cleanup(srv.Close)
	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})

	cases := []controls.ReanalyzeRequest{
		{Project: "p", Ticked: 0, Unsure: 0.1},
		{Project: "p", Ticked: 1, Unsure: 0.1},
		{Project: "p", Ticked: 0.3, Unsure: -0.1},
		{Project: "p", Ticked: 0.3, Unsure: 0.4},
		{Project: "", Ticked: 0.3, Unsure: 0.1},
	}
	for _, req := range cases {
		if _, err := client.Reanalyze(context.Background(), req); !errors.Is(err, controls.ErrAnalyzerRefused) {
			t.Errorf("Reanalyze(%+v): %v, want ErrAnalyzerRefused", req, err)
		}
	}
}

type analyzeSent struct {
	Project string  `json:"project"`
	ScanPDF string  `json:"scan_pdf"`
	Source  string  `json:"source"`
	Ticked  float64 `json:"ticked"`
	Unsure  float64 `json:"unsure"`
}

type reanalyzeSent struct {
	Project string  `json:"project"`
	Ticked  float64 `json:"ticked"`
	Unsure  float64 `json:"unsure"`
}
