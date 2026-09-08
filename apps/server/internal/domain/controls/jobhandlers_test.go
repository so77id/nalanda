package controls_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// The translation layer between the publication and the banner.
//
// It shipped entirely untested (#273 review, TEST-1): two mutations that
// gut it — reporting a partial run as a success, and collapsing every
// refusal to one message — both left `go test ./...` green. That matters
// more here than in most places, because this layer is the ONLY channel
// that tells a professor three students received nothing. It is the
// mitigation the stamp-before-send ordering depends on.

// runPublishJob drives the handler the way jobs.Runner does.
func runPublishJob(t *testing.T, svc *controls.Service, controlID string, p controls.PublishPayload) error {
	t.Helper()

	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal the payload: %v", err)
	}
	return controls.NewPublishHandler(svc)(context.Background(), controlID, raw)
}

// failureFrom unwraps the *jobs.Failure a handler returns, so a case can
// read the two fields the banner and the debug view render.
func failureFrom(t *testing.T, err error) *jobs.Failure {
	t.Helper()

	var failure *jobs.Failure
	if !errors.As(err, &failure) {
		t.Fatalf("the handler returned %v, want a *jobs.Failure the banner can render", err)
	}
	return failure
}

func TestAPublicationThatDeliversEverythingReportsSuccess(t *testing.T) {
	rig := newPublishRig(t)

	if err := runPublishJob(t, rig.svc, rig.controlID, controls.PublishPayload{
		ProfessorID: 7, Mode: string(controls.PublishModeReal),
	}); err != nil {
		t.Fatalf("the handler returned %v for a clean run", err)
	}
	if len(rig.dispatcher.sent) != 3 {
		t.Errorf("%d messages went out, want 3", len(rig.dispatcher.sent))
	}
}

// The decision the mutation gutted. The control IS stamped and most
// students DO have their correction, so this is not a failure in the sense
// the other four Kinds mean — but the banner is the only place a professor
// would ever learn that one person got nothing, and a green "listo" over a
// silent omission is the outcome this WP exists to prevent.
func TestAPartialPublicationIsReportedAsAFailureRatherThanADone(t *testing.T) {
	rig := newPublishRig(t)
	rig.dispatcher.failOn["bruno@udp.cl"] = controls.ErrSendRefused

	err := runPublishJob(t, rig.svc, rig.controlID, controls.PublishPayload{
		ProfessorID: 7, Mode: string(controls.PublishModeReal),
	})
	if err == nil {
		t.Fatal("a run that left a student with nothing reported success; the banner would say " +
			"'listo' and nobody would ever learn")
	}
	failure := failureFrom(t, err)

	if !strings.Contains(failure.Message, "2") || !strings.Contains(failure.Message, "1") {
		t.Errorf("the banner line %q does not say how many went and how many did not", failure.Message)
	}
	// The detail names WHICH copy, so the professor can chase it.
	if !strings.Contains(failure.Detail, "copia 2") {
		t.Errorf("the detail %q does not name the copy that failed", failure.Detail)
	}
}

// docs/security-notes.md §"Logs and personal data": the detail is stored on
// the job row, so it carries copy numbers and never a person.
func TestThePublishFailureDetailNamesCopiesAndNeverPeople(t *testing.T) {
	rig := newPublishRig(t)
	for _, to := range []string{"ana@udp.cl", "bruno@udp.cl", "carla@udp.cl"} {
		rig.dispatcher.failOn[to] = controls.ErrSendUnavailable
	}

	err := runPublishJob(t, rig.svc, rig.controlID, controls.PublishPayload{
		ProfessorID: 7, Mode: string(controls.PublishModeReal),
	})
	failure := failureFrom(t, err)

	for _, person := range []string{
		"ana@udp.cl", "bruno@udp.cl", "carla@udp.cl",
		"Ana", "Bruno", "Carla",
		// The surnames too, since #273's follow-up: the greeting now
		// carries the whole name, so a detail line that echoed the
		// message would leak more of a person than it used to.
		"Soto", "Pérez", "Muñoz", "SOTO", "PÉREZ", "MUÑOZ",
	} {
		if strings.Contains(failure.Detail, person) || strings.Contains(failure.Message, person) {
			t.Errorf("the job row carries %q; it must name copies, not people", person)
		}
	}
	for _, copyNumber := range []string{"copia 1", "copia 2", "copia 3"} {
		if !strings.Contains(failure.Detail, copyNumber) {
			t.Errorf("the detail does not name %s", copyNumber)
		}
	}
}

// The mutation that collapsed these to one message survived the whole
// suite. Each refusal has a different repair, and a professor sent to the
// wrong one is a professor who cannot fix their own problem.
func TestEachRefusalGetsItsOwnBannerMessage(t *testing.T) {
	for _, tc := range []struct {
		name   string
		break_ func(*publishRig)
		expect string
	}{
		{"no account connected", func(r *publishRig) {
			r.svc.Senders = fakeSenders{sender: controls.Sender{Name: "Miguel", Email: "miguel@udp.cl"}}
		}, "Gmail"},
		{"the correction is still open", func(r *publishRig) {
			r.store.controls[0].State = controls.InReview
		}, "cerrada"},
		{"no course", func(r *publishRig) {
			r.store.controls[0].CourseID = nil
		}, "curso"},
		{"this server delivers nothing", func(r *publishRig) {
			r.dispatcher.doesNotDeliver = true
		}, "enviar"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rig := newPublishRig(t)
			tc.break_(rig)

			err := runPublishJob(t, rig.svc, rig.controlID, controls.PublishPayload{
				ProfessorID: 7, Mode: string(controls.PublishModeReal),
			})
			failure := failureFrom(t, err)
			if !strings.Contains(failure.Message, tc.expect) {
				t.Errorf("the banner says %q, want it to mention %q — each refusal has a "+
					"different repair", failure.Message, tc.expect)
			}
			if failure.Detail == "" {
				t.Error("the refusal carries no detail saying what to do about it")
			}
		})
	}
}

// A second publication of the same control, reached through the runner
// rather than through the route.
// A second run through the RUNNER is a clean `done`, not a failure banner
// (issue #287).
//
// It used to report "este control ya fue publicado" and point the professor
// at an undo. That message was the visible end of the dead end this WP came
// out of: a partial run could not be finished from the page that showed it.
// Now the second run finds every copy already holding its correction, sends
// nothing, and says so by succeeding.
func TestASecondRunThroughTheRunnerIsHarmlessAndSaysSoBySucceeding(t *testing.T) {
	rig := newPublishRig(t)
	payload := controls.PublishPayload{ProfessorID: 7, Mode: string(controls.PublishModeReal)}

	if err := runPublishJob(t, rig.svc, rig.controlID, payload); err != nil {
		t.Fatalf("the first run: %v", err)
	}
	if err := runPublishJob(t, rig.svc, rig.controlID, payload); err != nil {
		t.Fatalf("the second run returned %v, want it to be harmless", err)
	}
	if len(rig.dispatcher.sent) != 3 {
		t.Errorf("%d messages went out across two runs, want 3", len(rig.dispatcher.sent))
	}
}

func TestAMalformedPublishPayloadIsAFailureAndNotAPanic(t *testing.T) {
	rig := newPublishRig(t)

	err := controls.NewPublishHandler(rig.svc)(
		context.Background(), rig.controlID, []byte("{not json"))
	failure := failureFrom(t, err)
	if failure.Message == "" {
		t.Error("the failure carries no message for the banner")
	}
	if len(rig.dispatcher.sent) != 0 {
		t.Error("a job whose payload could not be read still sent mail")
	}
}

// The gate the review added (PUB-2), at the domain. Under a transport that
// delivers nothing every Send "succeeds", so without this the publication
// counted three successes, stamped the control and reported a class that
// was never written to — on the DEFAULT mode.
func TestAPublicationIsRefusedAndNothingIsStampedWhenTheTransportDeliversNothing(t *testing.T) {
	rig := newPublishRig(t)
	rig.dispatcher.doesNotDeliver = true

	_, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal})
	if !errors.Is(err, controls.ErrCannotDeliver) {
		t.Fatalf("Publish returned %v, want ErrCannotDeliver", err)
	}
	control, _ := rig.store.ControlByID(context.Background(), rig.controlID)
	if control.PublishedAt != nil {
		t.Error("a server that delivers nothing still stamped the control published")
	}
	if len(rig.dispatcher.sent) != 0 {
		t.Error("messages were handed to a transport that delivers nothing")
	}
}

// And a REHEARSAL is still allowed under it: rehearsing on a server that
// delivers nothing is coherent, and it changes no state either way.
func TestARehearsalIsAllowedWhenTheTransportDeliversNothing(t *testing.T) {
	rig := newPublishRig(t)
	rig.dispatcher.doesNotDeliver = true

	result, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal, TestTo: "miguel@gmail.com"})
	if err != nil {
		t.Fatalf("a rehearsal was refused: %v", err)
	}
	if result.Sent != 3 {
		t.Errorf("the rehearsal sent %d, want the whole batch", result.Sent)
	}
}

// The escape hatch, at the domain. Publication was one-way with no
// exceptions, so any run that stamped without delivering left the class
// permanently unreachable through the app.
// How many people hold their correction is DERIVED from the stamped
// readings (issue #287), which is why control.published_sent went away.
//
// The column was written once after the loop and could disagree with
// reality in both directions: a run that died before the bookkeeping write
// left NULL over a class that had been mailed, and it could not move at all
// when one copy was re-sent afterwards. Counting the stamps cannot be wrong
// — and this case is what says the stamps are actually there to count.
func TestOnlyTheCopiesThatWentOutAreStamped(t *testing.T) {
	rig := newPublishRig(t)
	rig.dispatcher.failOn["bruno@udp.cl"] = controls.ErrSendRefused

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	stamped := 0
	for _, reading := range rig.readings.readings {
		if reading.PublishedAt != nil {
			stamped++
		}
	}
	if stamped != 2 {
		t.Errorf("%d copies are stamped, want the 2 that actually went out", stamped)
	}
	if rig.readings.readings[1].PublishedAt != nil {
		t.Error("the copy whose send was refused is stamped; the next run would skip it")
	}
}

// `publication_mode` records what HAPPENED, not what the form asked for.
//
// The same lie as PUB-2, one layer up and found by the docs lens rather
// than the code one (#273 review, DAC-8): a deployment-wide `staging`
// transport DELIVERS — so `Delivers()` is true and the publication is
// allowed — but it delivers to the professor. Stamping the form's `real`
// there makes the page say the class was written to.
func TestADeploymentWideStagingRunIsRecordedAsStagingWhateverTheFormAsked(t *testing.T) {
	rig := newPublishRig(t)
	rig.dispatcher.redirects = true

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	control, _ := rig.store.ControlByID(context.Background(), rig.controlID)
	if control.PublicationMode != controls.PublishModeStaging {
		t.Errorf("publication_mode = %q after a run that reached nobody in the class, want %q — "+
			"the page words `real` as \"las correcciones se enviaron a los estudiantes\"",
			control.PublicationMode, controls.PublishModeStaging)
	}
}

// And the ordinary case still records what it did, so the fix above cannot
// have been "always say staging".
func TestARealRunIsRecordedAsReal(t *testing.T) {
	rig := newPublishRig(t)

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	control, _ := rig.store.ControlByID(context.Background(), rig.controlID)
	if control.PublicationMode != controls.PublishModeReal {
		t.Errorf("publication_mode = %q, want %q", control.PublicationMode, controls.PublishModeReal)
	}
}

// The banner names every outcome, not only the sends (#287 review, COR-4).
//
// AlreadySent and Skipped were both computed and surfaced nowhere — the
// same defect issue #287 opens by naming about Skipped. A resume that
// retries one failed copy and finds the other two finished reported "se
// enviaron 0 correcciones y 1 fallaron", which reads as a run that did
// nothing rather than as one that had nothing left to do.
func TestThePublishBannerNamesTheCopiesAlreadySent(t *testing.T) {
	rig := newPublishRig(t)
	payload := controls.PublishPayload{ProfessorID: 7, Mode: string(controls.PublishModeReal)}
	rig.dispatcher.failOn["bruno@udp.cl"] = controls.ErrSendUnavailable

	// The first run leaves two copies sent and one refused.
	if err := runPublishJob(t, rig.svc, rig.controlID, payload); err == nil {
		t.Fatal("the first run reported success over a refused send")
	}

	// The second retries the refused copy and skips the two that are done.
	failure := failureFrom(t, runPublishJob(t, rig.svc, rig.controlID, payload))
	if !strings.Contains(failure.Message, "2 ya estaban al día") {
		t.Errorf("the banner does not say the other copies were already sent: %q", failure.Message)
	}
	if !strings.Contains(failure.Message, "1 falló") {
		t.Errorf("the banner lost the failure it exists to report: %q", failure.Message)
	}
}
