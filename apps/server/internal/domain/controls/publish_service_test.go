package controls_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker/amctest"
)

// The publication loop. What is worth pinning is not "does it send" — it is
// every case where it must NOT, and the ordering that decides what a crash
// halfway through costs.

type fakeRoster struct {
	code       string
	recipients map[int64]controls.Recipient
	err        error
}

func (f fakeRoster) CourseForPublication(context.Context, int64) (string, map[int64]controls.Recipient, error) {
	if f.err != nil {
		return "", nil, f.err
	}
	return f.code, f.recipients, nil
}

type fakeSenders struct {
	sender controls.Sender
	err    error
}

func (f fakeSenders) SenderFor(context.Context, int64) (controls.Sender, error) {
	if f.err != nil {
		return controls.Sender{}, f.err
	}
	return f.sender, nil
}

type capturingDispatcher struct {
	sent []controls.Message
	// failOn maps a recipient to the error its send returns, so a case can
	// break one copy of a batch and watch the others land.
	failOn map[string]error
	// doesNotDeliver makes this stand in for stub or dryrun.
	doesNotDeliver bool
	// onFirstSend runs before the first message is accepted, so a case can
	// observe the world AS IT IS at that instant. This is the only way to
	// pin the stamp-before-send ordering: the loop never returns early, so
	// a test that only looks at the end state passes over an
	// implementation that stamps afterwards. Verified by mutation — moving
	// MarkPublished below the loop left the previous version of that case
	// green.
	onFirstSend func()
}

// delivers defaults to TRUE via the zero value being inverted: a case that
// wants a non-delivering transport says so explicitly, so the ordinary rig
// reads as the ordinary deployment.
func (d *capturingDispatcher) Delivers() bool { return !d.doesNotDeliver }

func (d *capturingDispatcher) Send(_ context.Context, _ int64, msg controls.Message) (string, error) {
	if d.onFirstSend != nil {
		d.onFirstSend()
		d.onFirstSend = nil
	}
	if err, bad := d.failOn[msg.To]; bad {
		return "", err
	}
	d.sent = append(d.sent, msg)
	return "SENT-1", nil
}

// publishReadings is a ReadingStore holding one control's copies. The
// package's own fakeReadingStore answers ReadingsByControl with nil, which
// is exactly the method a publication is a loop over.
type publishReadings struct {
	readings []controls.Reading
}

func (r *publishReadings) ReadingsByControl(context.Context, string) ([]controls.Reading, error) {
	return r.readings, nil
}
func (r *publishReadings) UpsertReadingsFromReport(context.Context, string, controls.Report, time.Time) error {
	return nil
}
func (r *publishReadings) MarkMissingAsNotPresent(context.Context, string, time.Time) error {
	return nil
}
func (r *publishReadings) ReadingByCopy(context.Context, string, int) (controls.Reading, error) {
	return controls.Reading{}, controls.ErrReadingNotFound
}
func (*publishReadings) SetAnswerOverride(context.Context, int64, string, controls.AnswerOverride) error {
	return nil
}
func (*publishReadings) ClearAnswerOverride(context.Context, int64, string) error { return nil }
func (*publishReadings) SetRUTOverride(context.Context, int64, string, time.Time) error {
	return nil
}
func (*publishReadings) ClearRUTOverride(context.Context, int64) error { return nil }
func (*publishReadings) CopiesForStudent(context.Context, int64) ([]controls.StudentCopy, error) {
	return nil, nil
}
func (*publishReadings) SetReadingStudent(context.Context, int64, *int64) error { return nil }
func (*publishReadings) SetControlState(context.Context, string, controls.State) error {
	return nil
}

// publishRig is a graded control with three matched, gradeable copies and
// an annotated PDF for each — the state a professor is in when they press
// "Publicar", and the baseline every case below breaks one thing in.
type publishRig struct {
	svc        *controls.Service
	dispatcher *capturingDispatcher
	store      *fakeStore
	readings   *publishReadings
	controlID  string
}

const publishControlID = "CTRLPUBLISH0000000000000A"

func newPublishRig(t *testing.T) *publishRig {
	t.Helper()

	b, err := bank.Parse(strings.NewReader(bankJSON))
	if err != nil {
		t.Fatalf("bank.Parse: %v", err)
	}
	workDir := t.TempDir()
	courseID := int64(4)

	store := newFakeStore()
	store.controls = append(store.controls, controls.Control{
		ID: publishControlID, Name: "Control 2",
		QuestionsPerCopy: 2, Copies: 3,
		State: controls.Graded, CourseID: &courseID,
		Ticked: controls.DefaultTicked, Unsure: controls.DefaultUnsure,
	})

	readings := &publishReadings{}
	for copyNumber := 1; copyNumber <= 3; copyNumber++ {
		studentID := int64(copyNumber * 10)
		readings.readings = append(readings.readings, controls.Reading{
			ControlID: publishControlID, CopyNumber: copyNumber,
			StudentID: &studentID, RUTStatus: controls.RUTStatusOK,
			CopyStatus: controls.CopyStatusOK,
			Answers: []controls.Answer{
				{QuestionRef: "q1", Status: controls.AnswerStatusOK, Score: 1, Max: 1},
				{QuestionRef: "q2", Status: controls.AnswerStatusOK, Score: 1, Max: 1},
			},
		})

		name := filepath.Join("controls", publishControlID,
			fmt.Sprintf("anotado-%d.pdf", copyNumber))
		full := filepath.Join(workDir, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		if err := os.WriteFile(full, []byte("%PDF fake"), 0o644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if err := store.RecordAnnotated(context.Background(), controls.AnnotatedCopy{
			ControlID: publishControlID, CopyNumber: copyNumber, Path: name,
		}); err != nil {
			t.Fatalf("RecordAnnotated: %v", err)
		}
	}

	dispatcher := &capturingDispatcher{failOn: map[string]error{}}
	gen := &amctest.Fake{WorkDir: workDir, SujetSize: 42}
	svc := controls.NewService(controls.Service{
		Bank: bank.NewStaticLive(b), Store: store, Generator: gen,
		Analyzer: gen, Readings: readings, Annotator: gen,
		Matcher: noMatcher{}, Dispatcher: dispatcher,
		Roster: fakeRoster{code: "CIT2006-03", recipients: map[int64]controls.Recipient{
			10: {Name: "Ana", Email: "ana@udp.cl"},
			20: {Name: "Bruno", Email: "bruno@udp.cl"},
			30: {Name: "Carla", Email: "carla@udp.cl"},
		}},
		Senders: fakeSenders{sender: controls.Sender{
			Name: "Miguel", Email: "miguel@udp.cl", GmailAddress: "miguel@gmail.com",
		}},
		AnnotateEnabled: true,
		WorkDir:         workDir,
		Now:             func() time.Time { return time.Unix(1_757_260_800, 0).UTC() },
		Seed:            1242,
		Log:             slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	return &publishRig{svc: svc, dispatcher: dispatcher, store: store,
		readings: readings, controlID: publishControlID}
}

func TestPublishSendsOneMessagePerDeliverableCopy(t *testing.T) {
	rig := newPublishRig(t)

	result, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if result.Sent != 3 || len(result.Failures) != 0 {
		t.Fatalf("result = %+v, want three sent and no failures", result)
	}

	to := map[string]bool{}
	for _, msg := range rig.dispatcher.sent {
		to[msg.To] = true
		if msg.From != "miguel@gmail.com" {
			t.Errorf("From = %q, want the connected account", msg.From)
		}
		if len(msg.Attachment.Content) == 0 {
			t.Error("a message went out with no correction attached")
		}
	}
	for _, want := range []string{"ana@udp.cl", "bruno@udp.cl", "carla@udp.cl"} {
		if !to[want] {
			t.Errorf("%s received nothing", want)
		}
	}
}

// The ordering contract, measured where it is observable.
//
// A test that only looks at the end state CANNOT fail: the loop never
// returns early, so an implementation that stamps afterwards ends in the
// same place. The first version of this case did exactly that and survived
// the mutation. What the contract actually says is that the stamp has
// already happened when the first message goes out — so the dispatcher is
// asked, at that instant.
//
// Why it matters: an unstamped control with twenty students already emailed
// is a control the professor publishes again, and the twenty receive a
// second copy of a grade. Stamping first makes a crash cost the un-sent
// half, which a failure list names and a future resend can pick up.
func TestTheControlIsAlreadyStampedWhenTheFirstMessageGoesOut(t *testing.T) {
	rig := newPublishRig(t)

	var stampedAtFirstSend bool
	rig.dispatcher.onFirstSend = func() {
		control, err := rig.store.ControlByID(context.Background(), rig.controlID)
		if err != nil {
			t.Errorf("ControlByID during the send: %v", err)
			return
		}
		stampedAtFirstSend = control.PublishedAt != nil
	}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if len(rig.dispatcher.sent) == 0 {
		t.Fatal("nothing was sent, so the ordering was never observed")
	}
	if !stampedAtFirstSend {
		t.Error("the first message went out before the control was stamped published; a crash " +
			"between the two mails everybody a second time on the next attempt")
	}
}

// And a REHEARSAL stamps nothing, observed at the same instant.
func TestARehearsalHasNotStampedTheControlWhenItSends(t *testing.T) {
	rig := newPublishRig(t)

	var stamped bool
	rig.dispatcher.onFirstSend = func() {
		control, _ := rig.store.ControlByID(context.Background(), rig.controlID)
		stamped = control.PublishedAt != nil
	}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal, TestTo: "miguel@gmail.com"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if len(rig.dispatcher.sent) == 0 {
		t.Fatal("the rehearsal sent nothing, so the ordering was never observed")
	}
	if stamped {
		t.Error("a rehearsal stamped the control before sending")
	}
}

func TestPublishRefusesASecondPublication(t *testing.T) {
	rig := newPublishRig(t)
	req := controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID, req); err != nil {
		t.Fatalf("the first Publish: %v", err)
	}
	_, err := rig.svc.Publish(context.Background(), rig.controlID, req)
	if !errors.Is(err, controls.ErrAlreadyPublished) {
		t.Fatalf("the second Publish returned %v, want ErrAlreadyPublished", err)
	}
	if len(rig.dispatcher.sent) != 3 {
		t.Errorf("%d messages went out across two publications, want 3", len(rig.dispatcher.sent))
	}
}

// A rehearsal changes nothing and can be run as often as the professor
// likes — including on a control that was already published, which is the
// state a professor checking their own work is most likely to be in.
func TestATestSendChangesNoStateAndRepeats(t *testing.T) {
	rig := newPublishRig(t)
	req := controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal, TestTo: "miguel@gmail.com"}

	for range 3 {
		result, err := rig.svc.Publish(context.Background(), rig.controlID, req)
		if err != nil {
			t.Fatalf("a rehearsal: %v", err)
		}
		if result.Sent != 3 {
			t.Errorf("a rehearsal sent %d, want the whole batch", result.Sent)
		}
	}

	control, err := rig.store.ControlByID(context.Background(), rig.controlID)
	if err != nil {
		t.Fatalf("ControlByID: %v", err)
	}
	if control.PublishedAt != nil {
		t.Error("a rehearsal stamped the control published")
	}
	for _, msg := range rig.dispatcher.sent {
		if msg.To != "miguel@gmail.com" {
			t.Errorf("a rehearsal addressed %q; every message must go to the typed address", msg.To)
		}
	}
}

func TestAStagingPublicationRedirectsEveryMessageToTheProfessor(t *testing.T) {
	rig := newPublishRig(t)

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeStaging}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	for _, msg := range rig.dispatcher.sent {
		if msg.To != "miguel@udp.cl" {
			t.Errorf("a staging publication addressed %q, want the professor", msg.To)
		}
	}
}

// One bounce must not stop the batch. The whole reason publication is a
// loop with a failure list rather than a transaction.
func TestOneFailedCopyDoesNotStopTheOthers(t *testing.T) {
	rig := newPublishRig(t)
	rig.dispatcher.failOn["bruno@udp.cl"] = controls.ErrSendRefused

	result, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if result.Sent != 2 {
		t.Errorf("Sent = %d, want the two copies that could go", result.Sent)
	}
	if len(result.Failures) != 1 || result.Failures[0].CopyNumber != 2 {
		t.Fatalf("Failures = %+v, want exactly copy 2", result.Failures)
	}
	if !strings.Contains(result.Failures[0].Reason, "cuota") {
		t.Errorf("the reason %q does not tell the professor what to do about it",
			result.Failures[0].Reason)
	}
}

// The four refusals that stop a publication before anything is stamped.
// Each has its own repair, and each must leave the control untouched.
func TestPublishRefusesBeforeStampingWhenItCannotSend(t *testing.T) {
	for _, tc := range []struct {
		name    string
		break_  func(*publishRig)
		wantErr error
	}{
		{
			name:    "the correction is still open",
			break_:  func(r *publishRig) { r.store.controls[0].State = controls.InReview },
			wantErr: controls.ErrNotGraded,
		},
		{
			name:    "the control has no course",
			break_:  func(r *publishRig) { r.store.controls[0].CourseID = nil },
			wantErr: controls.ErrNoCourse,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rig := newPublishRig(t)
			tc.break_(rig)

			_, err := rig.svc.Publish(context.Background(), rig.controlID,
				controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal})
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("Publish returned %v, want %v", err, tc.wantErr)
			}
			if len(rig.dispatcher.sent) != 0 {
				t.Error("messages went out from a publication that should have been refused")
			}
			control, _ := rig.store.ControlByID(context.Background(), rig.controlID)
			if control.PublishedAt != nil {
				t.Error("a refused publication stamped the control")
			}
		})
	}
}

// A professor who never connected an account, or who disconnected one.
// Refused BEFORE the stamp, so connecting and publishing for real still
// works — a stamp here would lock them out of their own control forever,
// since publication is one-way.
func TestPublishRefusesAProfessorWithNoConnectedAccountWithoutStamping(t *testing.T) {
	rig := newPublishRig(t)
	rig.svc.Senders = fakeSenders{sender: controls.Sender{Name: "Miguel", Email: "miguel@udp.cl"}}

	_, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal})
	if !errors.Is(err, gmail.ErrNotConnected) {
		t.Fatalf("Publish returned %v, want ErrNotConnected", err)
	}
	control, _ := rig.store.ControlByID(context.Background(), rig.controlID)
	if control.PublishedAt != nil {
		t.Error("a control was stamped published by a professor who cannot send; publication is " +
			"one-way, so this would lock them out of their own control")
	}
}

// The three ordinary skips. A class where somebody missed the control, or
// whose RUT nobody could read, is a normal class — these are counted, not
// reported as failures, because a failure list is what the professor is
// asked to act on.
func TestCopiesWithNothingToSendAreSkippedRatherThanFailed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		break_ func(*publishRig, *publishReadings)
	}{
		{"nobody was matched to the copy", func(_ *publishRig, r *publishReadings) {
			r.readings[1].StudentID = nil
		}},
		{"the matched person is no longer enrolled", func(_ *publishRig, r *publishReadings) {
			gone := int64(999)
			r.readings[1].StudentID = &gone
		}},
		{"the grade is not defined", func(_ *publishRig, r *publishReadings) {
			r.readings[1].Answers[0].Status = controls.AnswerStatusDoubtful
		}},
		// The fourth skip, and the one whose mutation survived the whole
		// suite before the review (#273, COR-7). Reachable rather than
		// theoretical: 00014_roster.sql declares `email TEXT NOT NULL
		// DEFAULT ''`, so any Canvas import missing an address produces
		// exactly this row. The "no longer enrolled" case masks it,
		// because a missing map entry also yields an empty Email.
		{"the matched person has no address on file", func(rig *publishRig, r *publishReadings) {
			rig.svc.Roster = fakeRoster{code: "CIT2006-03", recipients: map[int64]controls.Recipient{
				10: {Name: "Ana", Email: "ana@udp.cl"},
				20: {Name: "Bruno", Email: ""},
				30: {Name: "Carla", Email: "carla@udp.cl"},
			}}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rig := newPublishRig(t)
			readings := rig.readings
			tc.break_(rig, readings)

			result, err := rig.svc.Publish(context.Background(), rig.controlID,
				controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal})
			if err != nil {
				t.Fatalf("Publish: %v", err)
			}
			if result.Sent != 2 || result.Skipped != 1 {
				t.Errorf("result = %+v, want two sent and one skipped", result)
			}
			if len(result.Failures) != 0 {
				t.Errorf("an ordinary skip was reported as a failure: %+v", result.Failures)
			}
		})
	}
}

// "Adjunto la corrección" with nothing attached is worse than no message:
// the student now has to ask.
func TestACopyWithNoAnnotatedPDFIsSkippedRatherThanSentEmpty(t *testing.T) {
	rig := newPublishRig(t)
	rig.store.annotated = map[string]controls.AnnotatedCopy{}
	for copyNumber := 1; copyNumber <= 3; copyNumber++ {
		if copyNumber == 2 {
			continue
		}
		_ = rig.store.RecordAnnotated(context.Background(), controls.AnnotatedCopy{
			ControlID: publishControlID, CopyNumber: copyNumber,
			Path: filepath.Join("controls", publishControlID, fmt.Sprintf("anotado-%d.pdf", copyNumber)),
		})
	}

	result, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if result.Sent != 2 || result.Skipped != 1 {
		t.Errorf("result = %+v, want the copy with no PDF skipped", result)
	}
	for _, msg := range rig.dispatcher.sent {
		if len(msg.Attachment.Content) == 0 {
			t.Error("a message promising a correction went out with nothing attached")
		}
	}
}
