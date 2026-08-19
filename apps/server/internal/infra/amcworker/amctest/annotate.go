package amctest

import (
	"context"
	"path/filepath"
	"strconv"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// AnnotateCopy satisfies controls.Annotator. Records the call and returns
// AnnotatedPath when set, otherwise the convention the worker follows:
// <project>/annotated/copy-<N>.pdf. AnnotateErr wins over both.
func (f *Fake) AnnotateCopy(_ context.Context, req controls.AnnotateRequest) (string, error) {
	f.mu.Lock()
	f.AnnotateCalls = append(f.AnnotateCalls, req)
	err := f.AnnotateErr
	path := f.AnnotatedPath
	f.mu.Unlock()

	if err != nil {
		return "", err
	}
	if path == "" {
		path = filepath.ToSlash(filepath.Join(req.Project, "annotated",
			"copy-"+strconv.Itoa(req.Copy)+".pdf"))
	}
	return path, nil
}

// AnnotateCallCount returns how many times AnnotateCopy was called.
func (f *Fake) AnnotateCallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.AnnotateCalls)
}

// LastAnnotateCall returns the last AnnotateCopy request, if any.
func (f *Fake) LastAnnotateCall() (controls.AnnotateRequest, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.AnnotateCalls) == 0 {
		return controls.AnnotateRequest{}, false
	}
	return f.AnnotateCalls[len(f.AnnotateCalls)-1], true
}

// Assert Fake implements controls.Annotator at compile time.
var _ controls.Annotator = (*Fake)(nil)
