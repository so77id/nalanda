package amcworker_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker"
)

func TestGenerateSendsProjectSourceAndCopies(t *testing.T) {
	var got struct {
		Project string `json:"project"`
		Source  string `json:"source"`
		Copies  int    `json:"copies"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/generate" {
			t.Errorf("worker got %s %s, want POST /generate", r.Method, r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		respond(w, http.StatusOK, map[string]any{
			"sujet":   "controls/abc/out/sujet.pdf",
			"corrige": "controls/abc/out/corrige.pdf",
			"calage":  "controls/abc/out/calage.xy",
			"copies":  30,
		})
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	assets, err := client.Generate(context.Background(), controls.GenerateRequest{
		Project: "controls/abc",
		Source:  "controls/abc/inputs/source.tex",
		Copies:  30,
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if got.Project != "controls/abc" || got.Source != "controls/abc/inputs/source.tex" || got.Copies != 30 {
		t.Errorf("worker received %+v", got)
	}
	if assets.Sujet != "controls/abc/out/sujet.pdf" {
		t.Errorf("Assets = %+v", assets)
	}
}

func TestGenerateRefusedOn4xxWrapsErrGeneratorRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusBadRequest, map[string]any{
			"error":  "source path does not exist",
			"detail": "no such file: controls/bogus/inputs/source.tex",
		})
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Generate(context.Background(), controls.GenerateRequest{
		Project: "controls/bogus", Source: "controls/bogus/inputs/source.tex", Copies: 5,
	})
	if !errors.Is(err, controls.ErrGeneratorRefused) {
		t.Errorf("Generate on 400: %v, want ErrGeneratorRefused", err)
	}
	// The worker's `error` string is what the operator will read; the
	// message must include it. `detail` is now included too — it carries
	// the last 4000 chars of AMC's stderr (Package Listings Error,
	// Emergency stop, missing file), which is the only diagnosable
	// signal when pdflatex refuses a source. It was dropped in the
	// original wire mapping, and "prepare failed (1)" was unactionable
	// in production (#208 hotfix, mirror of #210's analyze-path fix).
	// The /generate stderr is LaTeX output, not student data — safe to
	// log; the analyze path has its own struct because reader stderr
	// can carry RUT/name fragments.
	if !strings.Contains(err.Error(), "source path does not exist") {
		t.Errorf("error %q does not include worker's error message", err.Error())
	}
	if !strings.Contains(err.Error(), "no such file: controls/bogus/inputs/source.tex") {
		t.Errorf("error %q does not include worker's detail — 'prepare failed (1)' alone is unactionable (#208 hotfix)", err.Error())
	}
}

// A refusal WITHOUT a detail field falls back to the message-only shape
// (an older worker version, or a Failed() raised without a stderr tail).
// The parenthetical "(worker detail: ...)" must not appear in that case,
// or a reader sees `(worker detail: )` and thinks the stderr was empty
// when in fact the field was absent.
func TestGenerateRefusedOmitsDetailClauseWhenDetailAbsent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusBadRequest, map[string]any{
			"error": "copies must be at least 1",
		})
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Generate(context.Background(), controls.GenerateRequest{
		Project: "controls/abc", Source: "controls/abc/inputs/source.tex", Copies: 0,
	})
	if !errors.Is(err, controls.ErrGeneratorRefused) {
		t.Fatalf("Generate on 400: %v, want ErrGeneratorRefused", err)
	}
	if strings.Contains(err.Error(), "worker detail:") {
		t.Errorf("error %q includes an empty 'worker detail:' clause; the parenthetical must be omitted when detail is absent", err.Error())
	}
}

// The detail is collapsed to one line so a log aggregator keeps the whole
// AMC-stderr tail on one entry rather than splitting it across several
// unindexable half-messages. Newlines become " | ".
func TestGenerateRefusedCollapsesMultilineDetailIntoOneLine(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusBadRequest, map[string]any{
			"error":  "auto-multiple-choice prepare failed (1)",
			"detail": "line one\nline two\nline three",
		})
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Generate(context.Background(), controls.GenerateRequest{
		Project: "controls/abc", Source: "controls/abc/inputs/source.tex", Copies: 1,
	})
	if err == nil {
		t.Fatal("Generate: nil error, want ErrGeneratorRefused")
	}
	if strings.Contains(err.Error(), "\n") {
		t.Errorf("error contains a literal newline — the detail was not collapsed; err = %q", err.Error())
	}
	if !strings.Contains(err.Error(), "line one | line two | line three") {
		t.Errorf("error %q does not preserve every detail line joined by ' | '", err.Error())
	}
}

func TestGenerateFailedTransportWrapsErrGeneratorUnavailable(t *testing.T) {
	// Server that closes the connection without responding. That is the
	// shape a container that crashed at boot presents.
	l, err := listenerThatRefuses(t)
	if err != nil {
		t.Fatalf("listener: %v", err)
	}
	client := amcworker.New(amcworker.Config{BaseURL: "http://" + l})
	_, err = client.Generate(context.Background(), controls.GenerateRequest{
		Project: "controls/abc", Source: "controls/abc/inputs/source.tex", Copies: 1,
	})
	if !errors.Is(err, controls.ErrGeneratorUnavailable) {
		t.Errorf("Generate against a dead worker: %v, want ErrGeneratorUnavailable", err)
	}
}

func TestGenerateRefusedWhenWorkerSaysWrongCopyCount(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusOK, map[string]any{
			"sujet": "x/out/sujet.pdf", "corrige": "x/out/corrige.pdf", "calage": "x/out/calage.xy",
			"copies": 4, // we asked for 30
		})
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Generate(context.Background(), controls.GenerateRequest{
		Project: "controls/x", Source: "controls/x/inputs/source.tex", Copies: 30,
	})
	if !errors.Is(err, controls.ErrGeneratorRefused) {
		t.Errorf("Generate with copy mismatch: %v, want ErrGeneratorRefused", err)
	}
}

func TestGenerateRefusedWhenWorkerOmitsAPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		respond(w, http.StatusOK, map[string]any{
			"sujet": "x/out/sujet.pdf", "corrige": "", "calage": "x/out/calage.xy", "copies": 1,
		})
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	_, err := client.Generate(context.Background(), controls.GenerateRequest{
		Project: "controls/x", Source: "controls/x/inputs/source.tex", Copies: 1,
	})
	if !errors.Is(err, controls.ErrGeneratorRefused) {
		t.Errorf("Generate with missing path: %v, want ErrGeneratorRefused", err)
	}
}

func TestGenerateRejectsInvalidRequestBeforeCallingTheWorker(t *testing.T) {
	// A server that would panic the test if called. Nothing here should
	// reach it because Generate has to refuse client-side.
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatal("Generate reached the worker with an invalid request")
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})
	cases := []controls.GenerateRequest{
		{Project: "p", Source: "s", Copies: 0},
		{Project: "", Source: "s", Copies: 1},
		{Project: "p", Source: "", Copies: 1},
	}
	for _, req := range cases {
		if _, err := client.Generate(context.Background(), req); !errors.Is(err, controls.ErrGeneratorRefused) {
			t.Errorf("Generate(%+v): %v, want ErrGeneratorRefused", req, err)
		}
	}
}

// The whole reason this wrapper exists as a wrapper: AMC's state is sqlite
// files under one project directory, and two concurrent /generate calls
// against one project would race them (ADR-0030). The Client serialises
// them, and this test proves that by watching a slow handler.
func TestGenerateSerialisesConcurrentCallers(t *testing.T) {
	var inFlight, peak atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		now := inFlight.Add(1)
		for {
			p := peak.Load()
			if now <= p || peak.CompareAndSwap(p, now) {
				break
			}
		}
		time.Sleep(15 * time.Millisecond) // window in which a second caller could arrive
		inFlight.Add(-1)
		respond(w, http.StatusOK, map[string]any{
			"sujet": "x/out/sujet.pdf", "corrige": "x/out/corrige.pdf", "calage": "x/out/calage.xy", "copies": 1,
		})
	}))
	t.Cleanup(srv.Close)

	client := amcworker.New(amcworker.Config{BaseURL: srv.URL})

	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = client.Generate(context.Background(), controls.GenerateRequest{
				Project: "controls/x", Source: "controls/x/inputs/source.tex", Copies: 1,
			})
		}()
	}
	wg.Wait()

	if got := peak.Load(); got != 1 {
		t.Errorf("peak concurrent /generate calls = %d, want 1 (AMC is not re-entrant, ADR-0030)", got)
	}
}

// respond writes a JSON body with a status. Split out so the test cases
// stay legible.
func respond(w http.ResponseWriter, status int, body any) {
	buf, _ := json.Marshal(body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(buf)
}

// listenerThatRefuses returns "host:port" that opens and immediately closes
// every connection, so a client's Do returns an error rather than hanging.
func listenerThatRefuses(t *testing.T) (string, error) {
	t.Helper()
	// A closed listener is the shape a worker crashed at boot presents: the
	// port is not open, and connect returns "connection refused".
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hj, ok := w.(http.Hijacker)
		if !ok {
			io.WriteString(w, "no hijacker")
			return
		}
		c, _, err := hj.Hijack()
		if err != nil {
			return
		}
		_ = c.Close()
	}))
	// Close the server's listener before returning: the URL still parses,
	// but the port is closed and Do reports connection refused.
	url := srv.URL
	srv.Close()
	return strings.TrimPrefix(url, "http://"), nil
}
