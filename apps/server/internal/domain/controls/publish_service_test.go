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
	// refused holds the messages failOn turned away, so onSend can number
	// the attempts rather than the successes — a case that watches the
	// world at the second SEND must count the second attempt.
	refused []controls.Message
	// failOn maps a recipient to the error its send returns, so a case can
	// break one copy of a batch and watch the others land.
	failOn map[string]error
	// doesNotDeliver makes this stand in for stub or dryrun.
	doesNotDeliver bool
	// redirects makes it stand in for a deployment-wide staging run.
	redirects bool
	// onFirstSend runs before the first message is accepted, so a case can
	// observe the world AS IT IS at that instant. This is the only way to
	// pin the stamp-before-send ordering: the loop never returns early, so
	// a test that only looks at the end state passes over an
	// implementation that stamps afterwards. Verified by mutation — moving
	// MarkPublished below the loop left the previous version of that case
	// green.
	onFirstSend func()
	// onSend runs before EVERY message is accepted, numbered from 1, for
	// the same reason onFirstSend exists one contract down: the per-copy
	// stamp of issue #287 happens between two sends, so the only instant
	// it is observable is while the loop is between them.
	onSend func(n int)
}

// delivers defaults to TRUE via the zero value being inverted: a case that
// wants a non-delivering transport says so explicitly, so the ordinary rig
// reads as the ordinary deployment.
func (d *capturingDispatcher) Delivers() bool { return !d.doesNotDeliver }

// redirectsToSender stands in for a deployment-wide `staging` transport:
// it DELIVERS, and it delivers to the professor whatever the message said.
func (d *capturingDispatcher) RedirectsToSender() bool { return d.redirects }

func (d *capturingDispatcher) Send(_ context.Context, _ int64, msg controls.Message) (string, error) {
	if d.onFirstSend != nil {
		d.onFirstSend()
		d.onFirstSend = nil
	}
	if d.onSend != nil {
		d.onSend(len(d.sent) + len(d.refused) + 1)
	}
	if err, bad := d.failOn[msg.To]; bad {
		d.refused = append(d.refused, msg)
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

// ReadingByCopy answers off the same held slice ReadingsByControl does,
// so a case that stamps through one reader sees it through the other —
// which is what PublishOne (issue #287) reads and what the copies table
// renders.
func (r *publishReadings) ReadingByCopy(_ context.Context, _ string, copyNumber int) (controls.Reading, error) {
	for _, reading := range r.readings {
		if reading.CopyNumber == copyNumber {
			return reading, nil
		}
	}
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

// PublicationCounts tallies the held readings the way the store's one
// statement tallies rows, so a case can assert the pair without a database.
func (r *publishReadings) PublicationCounts(context.Context) (map[string]controls.PublicationProgress, error) {
	out := map[string]controls.PublicationProgress{}
	for _, reading := range r.readings {
		progress := out[reading.ControlID]
		if reading.PublishedAt != nil {
			progress.Sent++
		}
		if reading.StudentID != nil {
			progress.Deliverable++
		}
		out[reading.ControlID] = progress
	}
	return out, nil
}

// ClearCopyPublications forgets every stamp on the held readings and
// reports how many it removed, exactly as the store's statement does — the
// count is what the flash quotes back, so a double returning len(readings)
// would let a wrong number pass.
func (r *publishReadings) ClearCopyPublications(context.Context, string) (int, error) {
	cleared := 0
	for i := range r.readings {
		if r.readings[i].PublishedAt == nil {
			continue
		}
		r.readings[i].PublishedAt = nil
		r.readings[i].PublishedGrade = ""
		cleared++
	}
	return cleared, nil
}

// MarkCopyPublished writes the stamp back onto the held reading, so a case
// can ask what the world looks like part-way through a loop rather than
// only at the end (issue #287). The real store does exactly this; a double
// that dropped the write would let a resume case pass over a Publish that
// never stamped anything.
func (r *publishReadings) MarkCopyPublished(_ context.Context, readingID int64, at time.Time, grade string) error {
	for i := range r.readings {
		if r.readings[i].ID == readingID {
			stamped := at
			r.readings[i].PublishedAt = &stamped
			r.readings[i].PublishedGrade = grade
			return nil
		}
	}
	return controls.ErrReadingNotFound
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
			// A distinct id per copy: MarkCopyPublished addresses one
			// reading, and three rows sharing the zero id would let a
			// stamp meant for copy 3 land on copy 1 with every count
			// still correct (issue #287).
			ID:        int64(copyNumber),
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
			10: {FirstName: "ANA", LastName: "SOTO VERA", Email: "ana@udp.cl"},
			20: {FirstName: "BRUNO", LastName: "PÉREZ DÍAZ", Email: "bruno@udp.cl"},
			30: {FirstName: "CARLA", LastName: "MUÑOZ LEÓN", Email: "carla@udp.cl"},
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

// THE ORDERING CONTRACT OF ISSUE #287, measured where it is observable.
//
// #273 stamped the CONTROL before the loop and nothing per copy, which
// bought "nobody is mailed twice" at the price of "nobody knows who was
// mailed at all". With a per-copy stamp the trade disappears — but only if
// each copy is stamped IMMEDIATELY after its own send, so that a process
// that dies between two sends leaves the truth behind it.
//
// A test that only checks the end state cannot fail: the loop never returns
// early, so stamping everything afterwards ends in the same place. The
// dispatcher is therefore asked what the world looks like at the SECOND
// send — by which time copy 1 must already be stamped.
func TestEachCopyIsStampedBeforeTheNextMessageGoesOut(t *testing.T) {
	rig := newPublishRig(t)

	var firstStampedAtSecondSend bool
	var observed bool
	rig.dispatcher.onSend = func(n int) {
		if n != 2 {
			return
		}
		observed = true
		firstStampedAtSecondSend = rig.readings.readings[0].PublishedAt != nil
	}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if !observed {
		t.Fatal("a second message never went out, so the ordering was never observed")
	}
	if !firstStampedAtSecondSend {
		t.Error("copy 1 was still unstamped when copy 2's message went out; a process that " +
			"died between the two would leave no record that copy 1 had been written to")
	}
}

// AC4: a publication that died mid-loop resumes from where it stopped.
//
// The world is set up as a crashed run left it — two copies stamped with
// the grade that went out, one untouched — and the next Publicar must write
// to exactly the third. This is the whole point of the WP: before it, the
// only recovery was to unpublish and mail the entire class again, so
// everybody who already had their correction got a second copy.
func TestAPublicationResumesTheCopiesThatDidNotGoOut(t *testing.T) {
	rig := newPublishRig(t)

	crashedAt := time.Unix(1_757_260_000, 0).UTC()
	for i := range 2 {
		rig.readings.readings[i].PublishedAt = &crashedAt
		rig.readings.readings[i].PublishedGrade = "7.0"
	}
	// The control was stamped before the loop, exactly as the crashed run
	// left it: a resume must not read that as "already done".
	if err := rig.store.MarkPublished(context.Background(), rig.controlID,
		crashedAt, string(controls.PublishModeReal)); err != nil {
		t.Fatalf("stamping the control as the crashed run left it: %v", err)
	}

	result, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal})
	if err != nil {
		t.Fatalf("the resume: %v", err)
	}
	if result.Sent != 1 {
		t.Errorf("the resume sent %d messages, want exactly the one copy that did not go out", result.Sent)
	}
	if result.AlreadySent != 2 {
		t.Errorf("AlreadySent = %d, want the two copies the crashed run had written to", result.AlreadySent)
	}
	if len(rig.dispatcher.sent) != 1 || rig.dispatcher.sent[0].To != "carla@udp.cl" {
		t.Fatalf("the resume wrote to %+v, want carla@udp.cl alone", rig.dispatcher.sent)
	}
}

// AC5 at the domain level: pressing Publicar twice sends nobody a second
// copy, and does not refuse.
//
// ErrAlreadyPublished existed only because there was no per-copy record.
// With one, a second publication is harmless BY CONSTRUCTION rather than by
// refusal — which is what lets the professor press the button after a
// partial run without having to reason about it first.
func TestASecondPublicationSendsNobodyASecondCopy(t *testing.T) {
	rig := newPublishRig(t)
	req := controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID, req); err != nil {
		t.Fatalf("the first Publish: %v", err)
	}
	result, err := rig.svc.Publish(context.Background(), rig.controlID, req)
	if err != nil {
		t.Fatalf("the second Publish returned %v, want it to be harmless", err)
	}
	if result.Sent != 0 || result.AlreadySent != 3 {
		t.Errorf("the second run reports Sent=%d AlreadySent=%d, want 0 and 3",
			result.Sent, result.AlreadySent)
	}
	if len(rig.dispatcher.sent) != 3 {
		t.Errorf("%d messages went out across two publications, want 3", len(rig.dispatcher.sent))
	}
}

// AC6 and AC7 together, because each is only meaningful beside the other: a
// re-corrected copy is re-sent with its new grade, and every copy nobody
// touched is left alone. Either assertion alone passes over an
// implementation that mails the whole class again.
func TestOnlyTheCopyWhoseGradeMovedIsReSent(t *testing.T) {
	rig := newPublishRig(t)
	req := controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID, req); err != nil {
		t.Fatalf("the first Publish: %v", err)
	}
	rig.dispatcher.sent = nil

	// The professor re-corrects Bruno's copy: one answer he was marked
	// wrong on is now right — which is what moves a 4.0 to a 7.0.
	bruno := &rig.readings.readings[1]
	bruno.Answers[0].Score = 0
	bruno.PublishedGrade = "7.0" // what he was actually mailed

	result, err := rig.svc.Publish(context.Background(), rig.controlID, req)
	if err != nil {
		t.Fatalf("the re-publication: %v", err)
	}
	if result.Sent != 1 || result.AlreadySent != 2 {
		t.Fatalf("result = %+v, want exactly the re-corrected copy sent", result)
	}
	if len(rig.dispatcher.sent) != 1 || rig.dispatcher.sent[0].To != "bruno@udp.cl" {
		t.Fatalf("the re-publication wrote to %+v, want bruno@udp.cl alone", rig.dispatcher.sent)
	}
	// And it carried the NEW grade, which is the reason to re-send at all.
	if bruno.PublishedGrade != "4.0" {
		t.Errorf("the re-sent copy is stamped %q, want the grade that just went out", bruno.PublishedGrade)
	}
}

// A copy whose send FAILED is not stamped, so the next Publicar picks it up
// (issue #287 §Problem 2).
//
// Before this, the banner named the copy numbers that failed and that was
// the end of the system's help: publishing was one-shot and the rehearsal
// mailed the whole batch to one address.
func TestAFailedCopyIsNotStampedAndTheNextRunPicksItUp(t *testing.T) {
	rig := newPublishRig(t)
	req := controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}
	rig.dispatcher.failOn["bruno@udp.cl"] = controls.ErrSendUnavailable

	first, err := rig.svc.Publish(context.Background(), rig.controlID, req)
	if err != nil {
		t.Fatalf("the first Publish: %v", err)
	}
	if first.Sent != 2 || len(first.Failures) != 1 {
		t.Fatalf("first result = %+v, want two sent and one failure", first)
	}
	if rig.readings.readings[1].PublishedAt != nil {
		t.Fatal("a copy whose send was refused was stamped anyway; the next run would skip it")
	}

	delete(rig.dispatcher.failOn, "bruno@udp.cl")
	rig.dispatcher.sent = nil

	second, err := rig.svc.Publish(context.Background(), rig.controlID, req)
	if err != nil {
		t.Fatalf("the retry: %v", err)
	}
	if second.Sent != 1 || len(rig.dispatcher.sent) != 1 || rig.dispatcher.sent[0].To != "bruno@udp.cl" {
		t.Errorf("the retry sent %+v, want bruno@udp.cl alone", rig.dispatcher.sent)
	}
}

// The control keeps ONE publication timestamp, stamped on the first run.
//
// It answers a question no per-copy row answers — when was this class
// published, and for real or as a rehearsal — so a resume must not re-date
// it. Re-stamping would move "Publicado el 8 de septiembre" forward every
// time a professor re-sent one copy.
func TestAResumeDoesNotReDateTheControlsPublication(t *testing.T) {
	rig := newPublishRig(t)
	req := controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}
	rig.dispatcher.failOn["carla@udp.cl"] = controls.ErrSendUnavailable

	if _, err := rig.svc.Publish(context.Background(), rig.controlID, req); err != nil {
		t.Fatalf("the first Publish: %v", err)
	}
	control, err := rig.store.ControlByID(context.Background(), rig.controlID)
	if err != nil {
		t.Fatalf("ControlByID: %v", err)
	}
	if control.PublishedAt == nil {
		t.Fatal("the first publication did not stamp the control")
	}
	first := *control.PublishedAt

	delete(rig.dispatcher.failOn, "carla@udp.cl")
	rig.svc.Now = func() time.Time { return first.Add(2 * time.Hour) }
	if _, err := rig.svc.Publish(context.Background(), rig.controlID, req); err != nil {
		t.Fatalf("the resume: %v", err)
	}

	control, err = rig.store.ControlByID(context.Background(), rig.controlID)
	if err != nil {
		t.Fatalf("ControlByID after the resume: %v", err)
	}
	if !control.PublishedAt.Equal(first) {
		t.Errorf("the resume re-dated the publication to %v, want it left at %v",
			control.PublishedAt, first)
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
				10: {FirstName: "ANA", LastName: "SOTO VERA", Email: "ana@udp.cl"},
				20: {FirstName: "BRUNO", LastName: "PÉREZ DÍAZ", Email: ""},
				30: {FirstName: "CARLA", LastName: "MUÑOZ LEÓN", Email: "carla@udp.cl"},
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

// PublishOne: the per-student send (issue #287 §6).
//
// The case Miguel raised first and the one that is routine rather than
// exceptional: a professor fixes one grade after publishing, and there was
// no way to send that student the corrected version. The rehearsal mailed
// the whole batch to one address; publishing was a 409.

func TestPublishOneSendsThatCopyAndStampsIt(t *testing.T) {
	rig := newPublishRig(t)

	if err := rig.svc.PublishOne(context.Background(), rig.controlID, 2, 7); err != nil {
		t.Fatalf("PublishOne: %v", err)
	}
	if len(rig.dispatcher.sent) != 1 || rig.dispatcher.sent[0].To != "bruno@udp.cl" {
		t.Fatalf("PublishOne wrote to %+v, want bruno@udp.cl alone", rig.dispatcher.sent)
	}
	if len(rig.dispatcher.sent[0].Attachment.Content) == 0 {
		t.Error("the message went out with no correction attached")
	}
	copy2 := rig.readings.readings[1]
	if copy2.PublishedAt == nil || copy2.PublishedGrade != "7.0" {
		t.Errorf("copy 2 is stamped %v/%q, want the moment and the grade that went out",
			copy2.PublishedAt, copy2.PublishedGrade)
	}
	// And nobody else was written to. A loop that ignored the copy number
	// would pass every assertion above.
	if rig.readings.readings[0].PublishedAt != nil || rig.readings.readings[2].PublishedAt != nil {
		t.Error("PublishOne stamped a copy it was not asked about")
	}
}

// AC8: it sends WHATEVER STATE the copy is in, including one already sent
// with the grade it still has.
//
// That is the whole point of the button. The staleness rule watches the
// GRADE, so a re-annotation that moved the marks without moving the total
// is invisible to it (§3) — and the professor, who knows whose marks they
// just fixed, is the override.
func TestPublishOneSendsACopyThatAlreadyWentOutUnchanged(t *testing.T) {
	rig := newPublishRig(t)

	if err := rig.svc.PublishOne(context.Background(), rig.controlID, 2, 7); err != nil {
		t.Fatalf("the first send: %v", err)
	}
	rig.dispatcher.sent = nil

	if err := rig.svc.PublishOne(context.Background(), rig.controlID, 2, 7); err != nil {
		t.Fatalf("the second send returned %v, want it to go out anyway", err)
	}
	if len(rig.dispatcher.sent) != 1 {
		t.Errorf("%d messages went out on the second press, want 1", len(rig.dispatcher.sent))
	}
}

// It does NOT stamp the control. "Publicado el 8 de septiembre" is a claim
// about a CLASS, and one student receiving their correction is not that.
func TestPublishOneDoesNotStampTheControlAsPublished(t *testing.T) {
	rig := newPublishRig(t)

	if err := rig.svc.PublishOne(context.Background(), rig.controlID, 1, 7); err != nil {
		t.Fatalf("PublishOne: %v", err)
	}
	control, err := rig.store.ControlByID(context.Background(), rig.controlID)
	if err != nil {
		t.Fatalf("ControlByID: %v", err)
	}
	if control.PublishedAt != nil {
		t.Error("one hand-sent copy stamped the whole class published")
	}
}

// Every refusal, one per row, each breaking exactly ONE thing in the rig.
//
// The three not-deliverable reasons are distinguished rather than collapsed
// because each has a different repair and all three are reached from the
// same button — the same reasoning publishFailureReason carries one layer
// down.
func TestPublishOneRefusesWithTheReasonThatFits(t *testing.T) {
	notDeliverable := func(reason controls.CopySkipReason) func(*testing.T, error) {
		return func(t *testing.T, err error) {
			t.Helper()
			if !errors.Is(err, controls.ErrCopyNotDeliverable) {
				t.Fatalf("PublishOne returned %v, want ErrCopyNotDeliverable", err)
			}
			var refusal *controls.CopyNotDeliverableError
			if !errors.As(err, &refusal) {
				t.Fatalf("the refusal carries no reason: %v", err)
			}
			if refusal.Reason != reason {
				t.Errorf("reason = %q, want %q", refusal.Reason, reason)
			}
		}
	}

	cases := []struct {
		name   string
		copyNo int
		setUp  func(*publishRig)
		check  func(*testing.T, error)
	}{
		{
			name:   "the correction is still open",
			copyNo: 1,
			setUp:  func(r *publishRig) { r.store.controls[0].State = controls.InReview },
			check: func(t *testing.T, err error) {
				t.Helper()
				if !errors.Is(err, controls.ErrNotGraded) {
					t.Errorf("got %v, want ErrNotGraded", err)
				}
			},
		},
		{
			name:   "the control belongs to no course",
			copyNo: 1,
			setUp:  func(r *publishRig) { r.store.controls[0].CourseID = nil },
			check: func(t *testing.T, err error) {
				t.Helper()
				if !errors.Is(err, controls.ErrNoCourse) {
					t.Errorf("got %v, want ErrNoCourse", err)
				}
			},
		},
		{
			name:   "this server sends no mail",
			copyNo: 1,
			setUp:  func(r *publishRig) { r.dispatcher.doesNotDeliver = true },
			check: func(t *testing.T, err error) {
				t.Helper()
				if !errors.Is(err, controls.ErrCannotDeliver) {
					t.Errorf("got %v, want ErrCannotDeliver", err)
				}
			},
		},
		{
			name:   "the copy is matched to nobody",
			copyNo: 1,
			setUp:  func(r *publishRig) { r.readings.readings[0].StudentID = nil },
			check:  notDeliverable(controls.SkipNoStudent),
		},
		{
			name:   "the copy has no defined grade",
			copyNo: 1,
			setUp: func(r *publishRig) {
				r.readings.readings[0].CopyStatus = controls.CopyStatusNotPresent
			},
			check: notDeliverable(controls.SkipNoGrade),
		},
		{
			name:   "the copy has no corrected PDF",
			copyNo: 1,
			setUp: func(r *publishRig) {
				if err := r.store.ClearAnnotated(context.Background(), r.controlID); err != nil {
					panic(err)
				}
			},
			check: notDeliverable(controls.SkipNoAnnotated),
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rig := newPublishRig(t)
			c.setUp(rig)

			err := rig.svc.PublishOne(context.Background(), rig.controlID, c.copyNo, 7)
			c.check(t, err)

			if len(rig.dispatcher.sent) != 0 {
				t.Errorf("%d messages went out over a refusal", len(rig.dispatcher.sent))
			}
			if rig.readings.readings[c.copyNo-1].PublishedAt != nil {
				t.Error("a refused copy was stamped as sent")
			}
		})
	}
}

// A copy nobody has read is a 404-shaped refusal, not a panic on a zero
// Reading — the hand-typed URL case.
func TestPublishOneRefusesACopyWithNoReading(t *testing.T) {
	rig := newPublishRig(t)

	err := rig.svc.PublishOne(context.Background(), rig.controlID, 99, 7)
	if !errors.Is(err, controls.ErrReadingNotFound) {
		t.Errorf("PublishOne on an unread copy returned %v, want ErrReadingNotFound", err)
	}
}

// A send the provider refuses leaves the copy UNSTAMPED, so the professor
// can press the button again and the next Publicar picks it up.
func TestPublishOneLeavesARefusedCopyUnstamped(t *testing.T) {
	rig := newPublishRig(t)
	rig.dispatcher.failOn["ana@udp.cl"] = controls.ErrSendRefused

	if err := rig.svc.PublishOne(context.Background(), rig.controlID, 1, 7); !errors.Is(err, controls.ErrSendRefused) {
		t.Fatalf("PublishOne returned %v, want the provider's refusal", err)
	}
	if rig.readings.readings[0].PublishedAt != nil {
		t.Error("a copy whose send was refused was stamped anyway")
	}
}

// The professor with no connected Gmail account is refused BEFORE anything
// is sent, with the sentinel the handler renders as "conéctala en tu
// perfil".
func TestPublishOneRefusesAProfessorWithNoConnectedAccount(t *testing.T) {
	rig := newPublishRig(t)
	rig.svc.Senders = fakeSenders{sender: controls.Sender{Name: "Miguel", Email: "miguel@udp.cl"}}

	if err := rig.svc.PublishOne(context.Background(), rig.controlID, 1, 7); !errors.Is(err, gmail.ErrNotConnected) {
		t.Errorf("PublishOne returned %v, want gmail.ErrNotConnected", err)
	}
}

// "Reenviar a todo el curso" (issue #287 §5), which replaced the undo.
//
// It exists for the case the staleness rule cannot see: the annotated PDFs
// were wrong and the grades were not. Stale watches the GRADE, so nothing
// about that situation is visible to it, and the alternative is one click
// per student.
func TestResendToWholeCourseForgetsEveryStampAndTheNextPublishMailsTheClass(t *testing.T) {
	rig := newPublishRig(t)
	req := controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID, req); err != nil {
		t.Fatalf("the first Publish: %v", err)
	}
	rig.dispatcher.sent = nil

	cleared, err := rig.svc.ResendToWholeCourse(context.Background(), rig.controlID)
	if err != nil {
		t.Fatalf("ResendToWholeCourse: %v", err)
	}
	if cleared != 3 {
		t.Errorf("cleared = %d, want the 3 copies that had gone out", cleared)
	}
	// It SENDS nothing itself: clearing and sending are two decisions, and
	// the professor has just been told how many people this affects.
	if len(rig.dispatcher.sent) != 0 {
		t.Errorf("%d messages went out on the clear itself", len(rig.dispatcher.sent))
	}

	result, err := rig.svc.Publish(context.Background(), rig.controlID, req)
	if err != nil {
		t.Fatalf("the Publish after the clear: %v", err)
	}
	if result.Sent != 3 || len(rig.dispatcher.sent) != 3 {
		t.Errorf("the next Publish sent %d of 3; the clear did not reach the loop", result.Sent)
	}
}

// The control's own publication date survives. The class WAS published on
// the day it was, and forgetting that would lose the one fact no per-copy
// row carries.
func TestResendToWholeCourseKeepsTheControlsPublicationDate(t *testing.T) {
	rig := newPublishRig(t)

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	before, err := rig.store.ControlByID(context.Background(), rig.controlID)
	if err != nil {
		t.Fatalf("ControlByID: %v", err)
	}

	if _, err := rig.svc.ResendToWholeCourse(context.Background(), rig.controlID); err != nil {
		t.Fatalf("ResendToWholeCourse: %v", err)
	}

	after, err := rig.store.ControlByID(context.Background(), rig.controlID)
	if err != nil {
		t.Fatalf("ControlByID after: %v", err)
	}
	if after.PublishedAt == nil || !after.PublishedAt.Equal(*before.PublishedAt) {
		t.Errorf("published_at moved from %v to %v", before.PublishedAt, after.PublishedAt)
	}
}

// Zero cleared is a coherent answer, not an error: a control nobody has
// published is a thing a professor can press this on by mistake.
func TestResendToWholeCourseOnAnUnpublishedControlClearsNothing(t *testing.T) {
	rig := newPublishRig(t)

	cleared, err := rig.svc.ResendToWholeCourse(context.Background(), rig.controlID)
	if err != nil {
		t.Fatalf("ResendToWholeCourse: %v", err)
	}
	if cleared != 0 {
		t.Errorf("cleared = %d, want 0", cleared)
	}
}
