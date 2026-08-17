package amctest_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker/amctest"
)

func TestFakeRecordsEveryCall(t *testing.T) {
	f := &amctest.Fake{}
	_, _ = f.Generate(context.Background(), controls.GenerateRequest{Project: "p", Source: "s", Copies: 3})
	_, _ = f.Generate(context.Background(), controls.GenerateRequest{Project: "q", Source: "t", Copies: 5})

	if f.CallCount() != 2 {
		t.Errorf("CallCount = %d, want 2", f.CallCount())
	}
	last, ok := f.LastCall()
	if !ok || last.Project != "q" || last.Copies != 5 {
		t.Errorf("LastCall = %+v, ok=%v", last, ok)
	}
}

func TestFakeReturnsConfiguredErr(t *testing.T) {
	f := &amctest.Fake{Err: errors.New("boom")}
	_, err := f.Generate(context.Background(), controls.GenerateRequest{Project: "p", Source: "s", Copies: 1})
	if err == nil || err.Error() != "boom" {
		t.Errorf("Generate: %v, want boom", err)
	}
}

func TestFakeWritesStubFilesWhenWorkDirIsSet(t *testing.T) {
	dir := t.TempDir()
	f := &amctest.Fake{WorkDir: dir, SujetSize: 42}

	assets, err := f.Generate(context.Background(), controls.GenerateRequest{
		Project: "controls/abc", Source: "controls/abc/inputs/source.tex", Copies: 2,
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if assets.Sujet != "controls/abc/out/sujet.pdf" || assets.Copies != 2 {
		t.Errorf("Assets = %+v", assets)
	}

	info, err := os.Stat(filepath.Join(dir, assets.Sujet))
	if err != nil {
		t.Fatalf("stat sujet: %v", err)
	}
	if info.Size() != 42 {
		t.Errorf("sujet size = %d, want 42", info.Size())
	}
	if _, err := os.Stat(filepath.Join(dir, assets.Corrige)); err != nil {
		t.Errorf("corrige missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, assets.Calage)); err != nil {
		t.Errorf("calage missing: %v", err)
	}
}

func TestFakeLeavesDiskAloneWithoutWorkDir(t *testing.T) {
	f := &amctest.Fake{} // no WorkDir
	assets, err := f.Generate(context.Background(), controls.GenerateRequest{
		Project: "p", Source: "s", Copies: 1,
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	// Paths are still returned so a caller checking response shape works;
	// the disk is not touched.
	if assets.Sujet == "" {
		t.Error("Sujet should be populated even without a WorkDir")
	}
}
