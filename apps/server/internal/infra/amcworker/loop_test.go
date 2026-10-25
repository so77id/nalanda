package amcworker_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore/s3test"
)

// volumeWorker is an AMC worker that writes into one volume the way the
// real one does — the sheet on /generate; page images, the ADR-0037 link,
// the capture and the report on /analyse; the corrected PDF on
// /annotate/copy — and refuses an analyse whose inputs are not on disk, as
// AMC would.
func volumeWorker(t *testing.T, volume *string) *httptest.Server {
	t.Helper()
	write := func(rel, content string) {
		path := filepath.Join(*volume, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Error(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Error(err)
		}
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Project string `json:"project"`
			ScanPDF string `json:"scan_pdf"`
			Source  string `json:"source"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		p := body.Project
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/generate":
			write(p+"/out/sujet.pdf", "%PDF-sujet")
			write(p+"/out/corrige.pdf", "%PDF-pauta")
			write(p+"/out/calage.xy", "calage")
			write(p+"/data/layout.sqlite", "layout")
			_, _ = w.Write([]byte(`{"sujet":"` + p + `/out/sujet.pdf","corrige":"` + p + `/out/corrige.pdf","calage":"` + p + `/out/calage.xy","copies":1}`))
		case "/analyse":
			for _, needed := range []string{body.Source, body.ScanPDF, p + "/data/layout.sqlite"} {
				if _, err := os.Stat(filepath.Join(*volume, filepath.FromSlash(needed))); err != nil {
					w.WriteHeader(http.StatusUnprocessableEntity)
					_, _ = w.Write([]byte(`{"error":"missing ` + needed + `"}`))
					return
				}
			}
			write(p+"/scans/batch-1.pdf-page-001-001.jpg", "jpeg")
			write(p+"/scans/list-batch-1.txt", "junk")
			write(p+"/data/capture.sqlite", "capture")
			link := filepath.Join(*volume, filepath.FromSlash(p), "scans", "copy-1-page-1.jpg")
			_ = os.Remove(link)
			if err := os.Symlink("batch-1.pdf-page-001-001.jpg", link); err != nil {
				t.Error(err)
			}
			_, _ = w.Write([]byte(sampleReport))
		case "/annotate/copy":
			write(p+"/annotated/copy-1.pdf", "%PDF-corregido")
			_, _ = w.Write([]byte(`{"path":"` + p + `/annotated/copy-1.pdf","copy":1}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// The checkpoint after S8 (issue #338): a control's whole loop against the
// bucket, from an EMPTY volume. The sheet is generated on one volume; the
// volume is then lost, and on a fresh one the batch is read and a copy
// corrected — every input the worker needs comes back from S3 first, and
// every file it makes reaches S3 after.
func TestAControlsLoopRunsFromAnEmptyVolumeAgainstTheBucket(t *testing.T) {
	ctx := context.Background()
	bucket := s3test.New()
	store := filestore.NewS3(bucket, "nalanda-test")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	const project = "controls/LOOP"

	volume := t.TempDir()
	worker := volumeWorker(t, &volume)
	clientOn := func(dir string) *amcworker.Client {
		return amcworker.New(amcworker.Config{BaseURL: worker.URL, Sync: filestore.NewSync(store, dir, log)})
	}
	write := func(rel, content string) {
		path := filepath.Join(volume, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// Volume A: what PrepareControl writes, then the generate.
	write(project+"/inputs/source.tex", `\documentclass{article}`)
	write(project+"/pool.json", `{"questions":[]}`)
	if _, err := clientOn(volume).Generate(ctx, controls.GenerateRequest{
		Project: project, Source: project + "/inputs/source.tex", Copies: 1,
	}); err != nil {
		t.Fatalf("Generate on the first volume: %v", err)
	}

	// The volume is lost. The sheet is still served — from S3 alone.
	volume = t.TempDir()
	sujet, err := store.Open(ctx, project+"/out/sujet.pdf")
	if err != nil {
		t.Fatalf("the sheet from S3 with no volume: %v", err)
	}
	if got, _ := io.ReadAll(sujet); string(got) != "%PDF-sujet" {
		t.Errorf("the sheet from S3 = %q", got)
	}
	_ = sujet.Close()

	// Volume B, empty: the professor uploads a batch and it is read.
	write(project+"/uploads/batch-1.pdf", "%PDF-escaneo")
	client := clientOn(volume)
	if _, err := client.Analyze(ctx, controls.AnalyzeRequest{
		Project: project, ScanPDF: project + "/uploads/batch-1.pdf", Source: project + "/inputs/source.tex",
		Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure,
	}); err != nil {
		t.Fatalf("Analyze on the empty volume: %v", err)
	}
	if _, err := client.AnnotateCopy(ctx, controls.AnnotateRequest{Project: project, Copy: 1, Ticked: controls.DefaultTicked}); err != nil {
		t.Fatalf("AnnotateCopy: %v", err)
	}

	for rel, want := range map[string]string{
		"inputs/source.tex": `\documentclass{article}`, "pool.json": `{"questions":[]}`,
		"out/sujet.pdf": "%PDF-sujet", "data/layout.sqlite": "layout",
		"uploads/batch-1.pdf": "%PDF-escaneo", "data/capture.sqlite": "capture",
		"scans/batch-1.pdf-page-001-001.jpg": "jpeg", "annotated/copy-1.pdf": "%PDF-corregido",
	} {
		if o, ok := bucket.Get("work/" + project + "/" + rel); !ok || string(o.Body) != want {
			t.Errorf("S3 holds %s = %q (%v), want %q", rel, o.Body, ok, want)
		}
	}
	if _, ok := bucket.Get("work/" + project + "/scans/list-batch-1.txt"); ok {
		t.Error("the getimages list reached S3")
	}
	// The review page reads the contract name from S3 through the link map.
	page, err := store.Open(ctx, project+"/scans/copy-1-page-1.jpg")
	if err != nil {
		t.Fatalf("the contract page from S3: %v", err)
	}
	if got, _ := io.ReadAll(page); string(got) != "jpeg" {
		t.Errorf("the contract page from S3 = %q", got)
	}
	_ = page.Close()
}
