package controls

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls/tex"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// WorkerWorkDir is where apps/amc-worker mounts its shared volume (ADR-0030
// §Operational: paths in a worker request name locations under /work). The
// generator's \lstinputlisting paths are absolute and must be what the
// WORKER sees, which is /work whatever the server's own mount is.
const WorkerWorkDir = "/work"

// projectPrefix is the subdirectory under WorkerWorkDir that holds every
// control's project. Named "controls" (English identifier, root CLAUDE.md).
const projectPrefix = "controls"

// ErrPoolTooSmall is Create's answer when the range resolved to fewer
// questions than the requested copies-per-copy. Wrapped by PoolTooSmallErr
// so a handler can render the counts in Spanish.
var ErrPoolTooSmall = errors.New("controls: the range does not have enough questions per copy")

// ErrSujetMissing is Create's answer when the worker returned success but
// the sujet.pdf on disk is zero bytes or absent. A broken generation the
// professor must not see as a healthy control (§Failure modes).
var ErrSujetMissing = errors.New("controls: the generated sujet.pdf is missing or empty")

// PoolTooSmallErr carries the counts a form message needs to compose the
// Spanish "Pediste N por copia, pero el rango solo tiene M".
type PoolTooSmallErr struct {
	Pool             int
	QuestionsPerCopy int
}

func (e PoolTooSmallErr) Error() string {
	return fmt.Sprintf("controls: pool has %d questions, less than %d per copy",
		e.Pool, e.QuestionsPerCopy)
}
func (e PoolTooSmallErr) Unwrap() error { return ErrPoolTooSmall }

// Service is the orchestration layer of §Design: it turns a form submission
// into files on disk plus a row in the database, all-or-nothing.
//
// The dependencies here are the ones the domain declared (Store, Generator)
// plus the bank the range resolves against and the shared-volume path the
// server writes files under. The seed is a constant per instance — a
// re-compile of the same input produces the same draw, ADR-0030's four
// silent traps need a deterministic input.
type Service struct {
	Bank      *bank.Bank
	Store     Store
	Generator Generator
	// Analyzer and Readings power the WP-F pipeline: upload → analyse →
	// persist a report → serve the review queue. Required — NewService
	// panics on either nil; no method here re-checks them, since a
	// wiring mistake is a panic at boot rather than a nil dereference
	// inside a request (backend-code-style.md §Errors).
	Analyzer Analyzer
	Readings ReadingStore
	// WorkDir is what the SERVER sees as the root of the shared volume.
	// In compose it is bind-mounted onto /work in the worker; in
	// development it may be any path the operator chose (see
	// NALANDA_WORK_DIR).
	WorkDir string
	Now     func() time.Time
	// Seed is what tex.Compile writes into \AMCrandomseed. Constant so a
	// re-compile is reproducible; a per-control seed is a future decision.
	Seed int64
	Log  *slog.Logger
}

// NewService returns a Service, refusing a set it cannot serve with — same
// reasoning as the other constructors in this app: a wiring mistake is a
// panic at boot rather than a nil dereference inside a request
// (backend-code-style.md §Errors).
func NewService(deps Service) *Service {
	switch {
	case deps.Bank == nil:
		panic("controls.NewService: no bank")
	case deps.Store == nil:
		panic("controls.NewService: no store")
	case deps.Generator == nil:
		panic("controls.NewService: no generator")
	case deps.Analyzer == nil:
		panic("controls.NewService: no analyzer")
	case deps.Readings == nil:
		panic("controls.NewService: no reading store")
	case deps.WorkDir == "":
		panic("controls.NewService: no work directory")
	case deps.Now == nil:
		panic("controls.NewService: no clock")
	case deps.Seed == 0:
		panic("controls.NewService: seed must be non-zero (\\AMCrandomseed refuses zero)")
	case deps.Log == nil:
		panic("controls.NewService: no logger")
	}
	return &deps
}

// CreateRequest is what a handler hands to Service.Create.
type CreateRequest struct {
	Name             string
	ApplicationDate  *time.Time
	RangeFrom        bank.SectionRef
	RangeTo          bank.SectionRef
	QuestionsPerCopy int
	Copies           int
	CreatedBy        int64
}

// Create is the whole orchestration: resolve the range against the bank,
// stage the inputs on the shared volume, ask the worker to compile, verify
// the PDF exists, persist the row.
//
// All-or-nothing (§Failure modes). Every path past the directory creation
// is guarded by a rollback that removes the whole project directory on
// failure: a control never has files without a database row, and vice
// versa — the "the row is committed and the files are on disk, or neither"
// promise.
func (s *Service) Create(ctx context.Context, req CreateRequest) (Control, error) {
	pool, err := s.Bank.Pool(req.RangeFrom, req.RangeTo)
	if err != nil {
		return Control{}, err
	}
	if len(pool) < req.QuestionsPerCopy {
		return Control{}, PoolTooSmallErr{Pool: len(pool), QuestionsPerCopy: req.QuestionsPerCopy}
	}

	id, err := NewID()
	if err != nil {
		return Control{}, fmt.Errorf("controls.Create: %w", err)
	}
	project := filepath.Join(projectPrefix, id)
	projectDir := filepath.Join(s.WorkDir, project)
	inputsDir := filepath.Join(projectDir, "inputs")

	// rollback removes the project directory. Best-effort: a failure to
	// remove is logged rather than escalated, since the caller already has
	// an error and forwarding a cleanup problem loses the real cause.
	// Declared BEFORE MkdirAll so a partial-create failure (parents made,
	// leaf denied) also runs it — RemoveAll on a non-existent path is a
	// no-op, so a MkdirAll that produced nothing costs nothing to clean.
	rollback := func() {
		if err := os.RemoveAll(projectDir); err != nil {
			s.Log.Warn("controls.Create: rollback failed", "project", projectDir, "error", err)
		}
	}

	if err := os.MkdirAll(inputsDir, 0o755); err != nil {
		rollback()
		return Control{}, fmt.Errorf("controls.Create: prepare %s: %w", projectDir, err)
	}

	for _, q := range pool {
		if q.Code == nil {
			continue
		}
		listingPath := filepath.Join(inputsDir, "question-"+q.ID+".txt")
		if err := os.WriteFile(listingPath, []byte(q.Code.Source), 0o644); err != nil {
			rollback()
			return Control{}, fmt.Errorf("controls.Create: stage listing %s: %w", q.ID, err)
		}
	}

	// The tex generator writes an ABSOLUTE listing path — from the
	// WORKER'S perspective, which is /work. The path here always begins
	// with WorkerWorkDir, whatever the server's own mount is.
	source, err := tex.Compile(tex.Input{
		Name:             req.Name,
		Pool:             pool,
		Copies:           req.Copies,
		QuestionsPerCopy: req.QuestionsPerCopy,
		Seed:             s.Seed,
		ListingsDir:      workerPath(project, "inputs"),
	})
	if err != nil {
		rollback()
		return Control{}, fmt.Errorf("controls.Create: compile tex: %w", err)
	}
	sourceHostPath := filepath.Join(inputsDir, "source.tex")
	if err := os.WriteFile(sourceHostPath, []byte(source), 0o644); err != nil {
		rollback()
		return Control{}, fmt.Errorf("controls.Create: write source: %w", err)
	}

	// Worker paths are relative to /work: it prefixes them itself with
	// its own mount (worker.py's under_work).
	assets, err := s.Generator.Generate(ctx, GenerateRequest{
		Project: project,
		Source:  filepath.Join(project, "inputs", "source.tex"),
		Copies:  req.Copies,
	})
	if err != nil {
		rollback()
		return Control{}, err
	}

	// The professor's headline deliverable exists on disk and has bytes.
	// A 0-byte sujet.pdf reports "success" from the worker on paths where
	// the compile crashed after opening the output file — measured in
	// #138 review, and enough to redden the whole path here.
	sujetPath := filepath.Join(s.WorkDir, assets.Sujet)
	info, err := os.Stat(sujetPath)
	if err != nil {
		rollback()
		return Control{}, fmt.Errorf("%w: stat %s: %v", ErrSujetMissing, sujetPath, err)
	}
	if info.Size() == 0 {
		rollback()
		return Control{}, fmt.Errorf("%w: %s is 0 bytes", ErrSujetMissing, sujetPath)
	}

	control := Control{
		ID:               id,
		Name:             req.Name,
		ApplicationDate:  req.ApplicationDate,
		RangeFrom:        req.RangeFrom,
		RangeTo:          req.RangeTo,
		QuestionsPerCopy: req.QuestionsPerCopy,
		Copies:           req.Copies,
		State:            Generated,
		CreatedAt:        s.Now(),
		CreatedBy:        req.CreatedBy,
	}
	entries := make([]PoolEntry, len(pool))
	for i, q := range pool {
		entries[i] = PoolEntry{Ref: q.ID, Order: i}
	}
	if err := s.Store.CreateControl(ctx, control, entries); err != nil {
		rollback()
		return Control{}, fmt.Errorf("controls.Create: persist: %w", err)
	}

	return control, nil
}

// List returns every control, delegating to the Store's own ordering
// (application_date desc, nulls last). Exposed on Service so the handler
// has ONE door into the controls domain rather than reaching into Store
// for reads and Service for writes — the ambiguity a reviewer noticed
// (WP-E review, ARQ-11).
func (s *Service) List(ctx context.Context) ([]Control, error) {
	return s.Store.ListControls(ctx)
}

// Get returns one control by id, or ErrControlNotFound.
func (s *Service) Get(ctx context.Context, id string) (Control, error) {
	return s.Store.ControlByID(ctx, id)
}

// ProjectDir is the directory (on the SERVER's side) where a control's
// files live. Handlers use it to serve the PDF downloads (S8).
//
// The layout it encodes — controls/<id>/{inputs,out} — is a MODEL of
// what the AMC worker writes at generation time (ADR-0030 §Operational
// leaves the directory shape to the caller; we chose it and pass its
// contents through to the worker). Nothing in this repo cross-checks the
// two, so a change to where the worker writes its output must be paired
// with a change here; a fixture-shape assertion between the amctest
// stubs and these paths pins the current agreement (ARQ-8).
func (s *Service) ProjectDir(controlID string) string {
	return filepath.Join(s.WorkDir, projectPrefix, controlID)
}

// SujetPath returns the sujet.pdf's full path on the server side.
func (s *Service) SujetPath(controlID string) string {
	return filepath.Join(s.ProjectDir(controlID), "out", "sujet.pdf")
}

// CorrigePath returns the corrige.pdf's full path on the server side.
func (s *Service) CorrigePath(controlID string) string {
	return filepath.Join(s.ProjectDir(controlID), "out", "corrige.pdf")
}

// workerPath joins components under WorkerWorkDir using forward slashes.
// The worker runs on Linux so slashes are safe; a Windows dev environment
// running this test suite would still emit a Linux-safe path.
func workerPath(parts ...string) string {
	joined := filepath.ToSlash(filepath.Join(parts...))
	return WorkerWorkDir + "/" + joined
}
