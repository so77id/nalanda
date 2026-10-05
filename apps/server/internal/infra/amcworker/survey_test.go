package amcworker_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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
