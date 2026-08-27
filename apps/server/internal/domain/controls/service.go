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

// paperOrDefault resolves an empty request field to DefaultPaper. A caller
// that omits the field never lands on a schema CHECK failure; a caller
// that sends a garbage value does — the handler's own ValidPaper is the
// gate for that path.
func paperOrDefault(p Paper) Paper {
	if p == "" {
		return DefaultPaper
	}
	return p
}

// Service is the orchestration layer of §Design: it turns a form submission
// into files on disk plus a row in the database, all-or-nothing.
//
// The dependencies here are the ones the domain declared (Store, Generator)
// plus the bank the range resolves against and the shared-volume path the
// server writes files under. The seed is a constant per instance — a
// re-compile of the same input produces the same draw, ADR-0030's four
// silent traps need a deterministic input.
type Service struct {
	// Bank is the live wrapper around the published question bank
	// (ADR-0032, issue #230). Reads call .Get() to pick up the current
	// snapshot; the ticker and the admin endpoint rotate it at runtime.
	Bank      *bank.LiveBank
	Store     Store
	Generator Generator
	// Analyzer and Readings power the WP-F pipeline: upload → analyse →
	// persist a report → serve the review queue. Required — NewService
	// panics on either nil; no method here re-checks them, since a
	// wiring mistake is a panic at boot rather than a nil dereference
	// inside a request (backend-code-style.md §Errors).
	Analyzer Analyzer
	Readings ReadingStore
	// Annotator and AnnotateEnabled are the annotate loop (issue #190):
	// every copy ends the control cycle with a corrected PDF. The
	// interface is required — a wiring mistake panics at boot; the flag
	// comes from config (NALANDA_ANNOTATE_ENABLED, default true) and is
	// the escape hatch that turns the whole flow off in production.
	Annotator       Annotator
	AnnotateEnabled bool
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
	case deps.Annotator == nil:
		panic("controls.NewService: no annotator")
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

// CreateRequest is what a handler hands to Service.PrepareControl
// (the async runner then picks up GenerateAssets).
type CreateRequest struct {
	Name             string
	ApplicationDate  *time.Time
	RangeFrom        bank.SectionRef
	RangeTo          bank.SectionRef
	QuestionsPerCopy int
	Copies           int
	// DuplexPadding, when true, keeps the historical AMC layout (each copy
	// padded to an even page count for duplex printing). False produces
	// one page per copy for simplex printing. Handler always passes an
	// explicit value; there is no Go-level default. Issue #185.
	DuplexPadding bool
	// Paper is the physical sheet the printed PDF is laid out for.
	// Handler always passes one of the two enumerated values (PaperLetter
	// or PaperA4) — an empty string arriving here is a caller bug that
	// Create resolves to DefaultPaper as a defensive belt over the
	// schema CHECK. Issue #208, ADR-0043.
	Paper     Paper
	CreatedBy int64
}

// PrepareControl is the sync half of the "create control" flow (issue
// #249, S5): resolve the pool, stage the input files on the shared
// volume, compile the tex, write the pool snapshot, and commit the
// row. The AMC worker call — Generator.Generate + sujet.pdf stat —
// is NOT run here; it lives on the async GenerateAssets so the HTTP
// request returns fast.
//
// The rollback still covers this half's failures (a bad tex compile,
// a bad write): if any step here fails the project directory is
// removed. On the async side (GenerateAssets), a worker failure
// leaves the row + input files intact so the operator can re-run the
// generation without losing the pool snapshot — a follow-up WP adds
// the explicit retry button (design's deferred list).
func (s *Service) PrepareControl(ctx context.Context, req CreateRequest) (Control, error) {
	pool, err := s.Bank.Get().Pool(req.RangeFrom, req.RangeTo)
	if err != nil {
		return Control{}, err
	}
	if len(pool) < req.QuestionsPerCopy {
		return Control{}, PoolTooSmallErr{Pool: len(pool), QuestionsPerCopy: req.QuestionsPerCopy}
	}

	id, err := NewID()
	if err != nil {
		return Control{}, fmt.Errorf("controls.PrepareControl: %w", err)
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
			s.Log.Warn("controls.PrepareControl: rollback failed", "project", projectDir, "error", err)
		}
	}

	if err := os.MkdirAll(inputsDir, 0o755); err != nil {
		rollback()
		return Control{}, fmt.Errorf("controls.PrepareControl: prepare %s: %w", projectDir, err)
	}

	for _, q := range pool {
		if q.Code == nil {
			continue
		}
		listingPath := filepath.Join(inputsDir, "question-"+q.ID+".txt")
		if err := os.WriteFile(listingPath, []byte(q.Code.Source), 0o644); err != nil {
			rollback()
			return Control{}, fmt.Errorf("controls.PrepareControl: stage listing %s: %w", q.ID, err)
		}
	}

	source, err := tex.Compile(tex.Input{
		Name:             req.Name,
		Pool:             pool,
		Copies:           req.Copies,
		QuestionsPerCopy: req.QuestionsPerCopy,
		Seed:             s.Seed,
		ListingsDir:      workerPath(project, "inputs"),
		DuplexPadding:    req.DuplexPadding,
		Paper:            string(paperOrDefault(req.Paper)),
	})
	if err != nil {
		rollback()
		return Control{}, fmt.Errorf("controls.PrepareControl: compile tex: %w", err)
	}
	sourceHostPath := filepath.Join(inputsDir, "source.tex")
	if err := os.WriteFile(sourceHostPath, []byte(source), 0o644); err != nil {
		rollback()
		return Control{}, fmt.Errorf("controls.PrepareControl: write source: %w", err)
	}
	if err := writePoolSnapshot(filepath.Join(projectDir, "pool.json"), id, req, pool, s.Seed, s.Now()); err != nil {
		rollback()
		return Control{}, fmt.Errorf("controls.PrepareControl: write pool snapshot: %w", err)
	}

	control := Control{
		ID:               id,
		Name:             req.Name,
		ApplicationDate:  req.ApplicationDate,
		RangeFrom:        req.RangeFrom,
		RangeTo:          req.RangeTo,
		QuestionsPerCopy: req.QuestionsPerCopy,
		Copies:           req.Copies,
		DuplexPadding:    req.DuplexPadding,
		Paper:            paperOrDefault(req.Paper),
		Ticked:           DefaultTicked,
		Unsure:           DefaultUnsure,
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
		return Control{}, fmt.Errorf("controls.PrepareControl: persist: %w", err)
	}
	return control, nil
}

// GenerateAssets is the async half of Create (issue #249, S5): call
// the AMC worker for the printable PDFs and verify sujet.pdf exists on
// disk with bytes. Called by the generate job handler on the runner
// goroutine; the row and input files must already exist (PrepareControl
// committed them).
//
// A failure here does NOT delete the row: the pool snapshot and
// source.tex are the professor's authored artefacts, and losing them
// on a transient worker outage would force a re-choose of the pool.
// The banner surfaces the failure; the operator's retry path (a future
// WP) reads the same row and re-runs this method.
func (s *Service) GenerateAssets(ctx context.Context, controlID string) error {
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return err
	}
	project := filepath.Join(projectPrefix, control.ID)
	assets, err := s.Generator.Generate(ctx, GenerateRequest{
		Project: project,
		Source:  filepath.Join(project, "inputs", "source.tex"),
		Copies:  control.Copies,
	})
	if err != nil {
		return err
	}
	sujetPath := filepath.Join(s.WorkDir, assets.Sujet)
	info, err := os.Stat(sujetPath)
	if err != nil {
		return fmt.Errorf("%w: stat %s: %v", ErrSujetMissing, sujetPath, err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("%w: %s is 0 bytes", ErrSujetMissing, sujetPath)
	}
	return nil
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

// PoolJSONPath returns the pool snapshot's full path on the server side
// (issue #198).
func (s *Service) PoolJSONPath(controlID string) string {
	return filepath.Join(s.ProjectDir(controlID), "pool.json")
}

// workerPath joins components under WorkerWorkDir using forward slashes.
// The worker runs on Linux so slashes are safe; a Windows dev environment
// running this test suite would still emit a Linux-safe path.
func workerPath(parts ...string) string {
	joined := filepath.ToSlash(filepath.Join(parts...))
	return WorkerWorkDir + "/" + joined
}
