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

	for _, person := range []string{"ana@udp.cl", "bruno@udp.cl", "carla@udp.cl", "Ana", "Bruno", "Carla"} {
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
func TestARepublishThroughTheRunnerIsReportedNotRetried(t *testing.T) {
	rig := newPublishRig(t)
	payload := controls.PublishPayload{ProfessorID: 7, Mode: string(controls.PublishModeReal)}

	if err := runPublishJob(t, rig.svc, rig.controlID, payload); err != nil {
		t.Fatalf("the first run: %v", err)
	}
	failure := failureFrom(t, runPublishJob(t, rig.svc, rig.controlID, payload))
	if !strings.Contains(failure.Message, "publicado") {
		t.Errorf("the banner says %q, want it to say the control was already published",
			failure.Message)
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
func TestUnpublishClearsAllThreeColumnsAndAllowsAnotherPublication(t *testing.T) {
	rig := newPublishRig(t)
	req := controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID, req); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if err := rig.svc.Unpublish(context.Background(), rig.controlID); err != nil {
		t.Fatalf("Unpublish: %v", err)
	}

	control, _ := rig.store.ControlByID(context.Background(), rig.controlID)
	switch {
	case control.PublishedAt != nil:
		t.Error("published_at survived the unpublish")
	case control.PublicationMode != "":
		t.Error("publication_mode survived, describing a publication that no longer exists")
	case control.PublishedSent != nil:
		t.Error("published_sent survived, describing a delivery that no longer exists")
	}

	if _, err := rig.svc.Publish(context.Background(), rig.controlID, req); err != nil {
		t.Errorf("the control could not be published again: %v", err)
	}
}

func TestUnpublishRefusesAControlThatWasNeverPublished(t *testing.T) {
	rig := newPublishRig(t)

	if err := rig.svc.Unpublish(context.Background(), rig.controlID); !errors.Is(err, controls.ErrNotPublished) {
		t.Fatalf("Unpublish returned %v, want ErrNotPublished", err)
	}
}

// The count that makes the unpublish confirmation honest. It is written
// AFTER the loop, so it records what actually went out rather than what was
// attempted.
func TestThePublicationRecordsHowManyItActuallyDelivered(t *testing.T) {
	rig := newPublishRig(t)
	rig.dispatcher.failOn["bruno@udp.cl"] = controls.ErrSendRefused

	if _, err := rig.svc.Publish(context.Background(), rig.controlID,
		controls.PublishRequest{ProfessorID: 7, Mode: controls.PublishModeReal}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	control, _ := rig.store.ControlByID(context.Background(), rig.controlID)
	if control.PublishedSent == nil {
		t.Fatal("the publication recorded no count, so the unpublish page cannot tell the truth")
	}
	if *control.PublishedSent != 2 {
		t.Errorf("recorded %d delivered, want the 2 that actually went out", *control.PublishedSent)
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
