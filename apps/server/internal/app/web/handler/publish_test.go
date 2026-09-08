package handler_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/infra/email"
)

// The route runs the same gates the domain runs, and the duplication is the
// point: a gate in the job answers minutes later through a banner, while one
// here answers now, on the page with the button. Each is asserted here for
// the MESSAGE it gives and in the domain for the invariant it protects.

// gradedControl leaves the fixture with one graded control filed under the
// fixture's course — the state a professor is in when the publish button is
// live.
func gradedControl(t *testing.T, f *controlsFixture) string {
	t.Helper()

	// The DOMAIN reads the real users row, not the handler's Gmail stub, so
	// the professor has to have actually connected an account for a
	// publication to get past its own gate. Without this the job refuses
	// with ErrNotConnected, the control is never stamped, and a case about
	// republishing quietly measures nothing.
	if _, err := f.db.ExecContext(context.Background(),
		"UPDATE users SET gmail_address = ? WHERE user_id = ?",
		"profesora@gmail.com", f.user.ID); err != nil {
		t.Fatalf("connecting the professor's account: %v", err)
	}

	controlID := f.createControl(t, "Control 2", 2)
	// createControl goes through the Service and leaves the course unset;
	// a publication needs one, because the roster is who it addresses.
	if err := f.service.AssignCourse(context.Background(), controlID, f.courseID); err != nil {
		t.Fatalf("AssignCourse: %v", err)
	}
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/close", nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.CloseCorrection(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("close status = %d, want 303", rec.Code)
	}
	return controlID
}

func (f *controlsFixture) publish(t *testing.T, controlID string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/publish", form)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Publish(rec, req)
	return rec
}

func TestPublishEnqueuesTheJobAndSaysItOnlyStarted(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	rec := f.publish(t, controlID, url.Values{"mode": {"real"}})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303\n%s", rec.Code, rec.Body.String())
	}

	job := f.waitLatestJobTerminal(t, controlID)
	if job.Kind != jobs.KindPublish {
		t.Fatalf("the latest job is %q, want a publish job", job.Kind)
	}

	// "empezó", never "listo". The job runs after this redirect, so a flash
	// claiming the class had been written to would be a claim this handler
	// is in no position to make.
	message := strings.ToLower(flashFromResponse(t, rec))
	for _, forbidden := range []string{"listo", "se enviaron", "enviadas"} {
		if strings.Contains(message, forbidden) {
			t.Errorf("the flash %q claims the send finished; the handler only enqueued it", message)
		}
	}
}

func TestPublishRefusesAModeThatIsNotOneOfTheTwo(t *testing.T) {
	for _, mode := range []string{"", "dryrun", "stub", "produccion"} {
		t.Run("mode="+mode, func(t *testing.T) {
			f := newControlsFixture(t)
			controlID := gradedControl(t, f)

			rec := f.publish(t, controlID, url.Values{"mode": {mode}})
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", rec.Code)
			}
			if _, err := f.jstore.LatestForControlByKind(
				context.Background(), controlID, jobs.KindPublish); err == nil {
				t.Error("a job was enqueued for a mode the form does not offer")
			}
		})
	}
}

// AC5: pressing Publicar a second time is ACCEPTED, and sends nobody a
// second copy (issue #287).
//
// It used to answer 409 and tell the professor to undo the publication
// first. That refusal is the dead end this WP came out of: a run that died
// half way could not be finished, and a re-corrected copy could not be
// re-sent to the one person whose grade moved. With a per-copy record the
// second press is harmless by construction, so there is nothing to refuse.
func TestASecondPublishIsAcceptedRatherThanRefused(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	if rec := f.publish(t, controlID, url.Values{"mode": {"real"}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("the first publish: %d", rec.Code)
	}
	f.waitLatestJobTerminal(t, controlID)

	rec := f.publish(t, controlID, url.Values{"mode": {"real"}})
	if rec.Code != http.StatusSeeOther {
		t.Errorf("status = %d, want 303\n%s", rec.Code, rec.Body.String())
	}
}

// Each refusal names what to do about it, because each has a different
// repair and all of them are reached from the same button.
func TestPublishRefusesAnOpenCorrectionAndSaysToCloseIt(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 2", 2)

	rec := f.publish(t, controlID, url.Values{"mode": {"real"}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "cierra la corrección") {
		t.Errorf("the message does not say what to do:\n%s", rec.Body.String())
	}
}

// A GRADED control with no course, because the gates run in order and an
// ungraded one would be refused one step earlier with a different message.
// This is the state every control that predates #272 is in.
func TestPublishRefusesAControlWithNoCourse(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)
	if _, err := f.db.ExecContext(context.Background(),
		"UPDATE control SET course_id = NULL WHERE id = ?", controlID); err != nil {
		t.Fatalf("un-assigning the course: %v", err)
	}

	rec := f.publish(t, controlID, url.Values{"mode": {"real"}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "curso") {
		t.Errorf("the message does not name the missing course:\n%s", rec.Body.String())
	}
}

func TestPublishRefusesAProfessorWithNoConnectedAccount(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)
	f.rebuildWithGmail(t, connectedGmail{disconnected: true})

	rec := f.publish(t, controlID, url.Values{"mode": {"real"}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "perfil") {
		t.Errorf("the message does not point at the profile page, which is the only repair:\n%s",
			rec.Body.String())
	}
	if _, err := f.jstore.LatestForControlByKind(
		context.Background(), controlID, jobs.KindPublish); err == nil {
		t.Error("a job was enqueued for a professor who cannot send")
	}
}

// A lookup that blinked must not block a publication. The domain checks
// again with the authority, so letting this through costs at worst the same
// refusal arriving through the banner instead of on this page.
func TestAFailedGmailLookupDoesNotBlockThePublication(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)
	f.rebuildWithGmail(t, connectedGmail{err: errors.New("the database blinked")})

	rec := f.publish(t, controlID, url.Values{"mode": {"real"}})
	if rec.Code != http.StatusSeeOther {
		t.Errorf("status = %d, want the publication to proceed\n%s", rec.Code, rec.Body.String())
	}
}

func TestPublishRefusesAControlThatDoesNotExist(t *testing.T) {
	f := newControlsFixture(t)

	rec := f.publish(t, "CTRLNOSUCHCONTROL00000001", url.Values{"mode": {"real"}})
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// The rehearsal. Its whole point is that nothing about the control moves,
// so that is what every case here measures.

func (f *controlsFixture) testSend(t *testing.T, controlID string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/test-send", form)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.TestSend(rec, req)
	return rec
}

func TestATestSendEnqueuesTheJobAndStampsNothing(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	rec := f.testSend(t, controlID, url.Values{"to": {"miguel@gmail.com"}})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303\n%s", rec.Code, rec.Body.String())
	}
	f.waitLatestJobTerminal(t, controlID)

	control, err := f.service.Get(context.Background(), controlID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if control.PublishedAt != nil {
		t.Error("a rehearsal stamped the control published")
	}

	// The address is echoed because the professor just typed it, and this
	// is the only chance to catch a typo before waiting for mail that went
	// somewhere else.
	if message := flashFromResponse(t, rec); !strings.Contains(message, "miguel@gmail.com") {
		t.Errorf("the flash %q does not name where the rehearsal went", message)
	}
}

// Repeatable, and repeatable on a control that has ALREADY been published —
// which is exactly the state a professor is in when a student says nothing
// arrived.
func TestATestSendRepeatsEvenAfterTheRealPublication(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	if rec := f.publish(t, controlID, url.Values{"mode": {"real"}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("the publication: %d", rec.Code)
	}
	f.waitLatestJobTerminal(t, controlID)

	for range 3 {
		rec := f.testSend(t, controlID, url.Values{"to": {"miguel@gmail.com"}})
		if rec.Code != http.StatusSeeOther {
			t.Fatalf("a rehearsal after publication: %d\n%s", rec.Code, rec.Body.String())
		}
		f.waitLatestJobTerminal(t, controlID)
	}
}

func TestATestSendRefusesAnAddressThatIsNotOne(t *testing.T) {
	for _, to := range []string{"", "   ", "miguel", "miguel@", "@gmail.com", "a b@c.cl"} {
		t.Run("to="+to, func(t *testing.T) {
			f := newControlsFixture(t)
			controlID := gradedControl(t, f)

			rec := f.testSend(t, controlID, url.Values{"to": {to}})
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", rec.Code)
			}
			if _, err := f.jstore.LatestForControlByKind(
				context.Background(), controlID, jobs.KindPublish); err == nil {
				t.Error("a job was enqueued for an address nobody can receive at")
			}
		})
	}
}

// `Nombre <a@b.cl>` parses, and only the bare address is kept: the display
// name would otherwise travel into a To header the professor did not intend
// to write.
func TestATestSendKeepsOnlyTheAddressFromANamedForm(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	rec := f.testSend(t, controlID, url.Values{"to": {"Miguel Rodríguez <miguel@gmail.com>"}})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303\n%s", rec.Code, rec.Body.String())
	}
	message := flashFromResponse(t, rec)
	if strings.Contains(message, "Miguel Rodríguez") {
		t.Errorf("the display name survived into %q", message)
	}
	if !strings.Contains(message, "miguel@gmail.com") {
		t.Errorf("the address did not survive into %q", message)
	}
}

func TestATestSendRefusesAnOpenCorrection(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 2", 2)

	rec := f.testSend(t, controlID, url.Values{"to": {"miguel@gmail.com"}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422", rec.Code)
	}
}

// The page. Every case here is about what a professor can and cannot press,
// because that is the whole of this slice — the POST already refuses what
// it must, and a button that is present-but-disabled and says why is what
// turns "nothing happens when I click" into an instruction.

func TestTheDetailPageOffersPublishOnAGradedControl(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	body := f.detailBody(t, controlID)
	if !strings.Contains(body, "/publish") {
		t.Error("the page offers no way to publish")
	}
	if !strings.Contains(body, "/test-send") {
		t.Error("the page offers no rehearsal")
	}
	if strings.Contains(body, "disabled>Publicar") {
		t.Error("Publicar is disabled on a control that is ready to publish")
	}
}

// Publication is not something a professor is thinking about while copies
// are still under review, and a permanently disabled button on every fresh
// control teaches them to ignore disabled buttons.
func TestAnUngradedControlShowsNoPublicationSection(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 2", 2)
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	body := f.detailBody(t, controlID)
	if strings.Contains(body, "Enviar las correcciones") {
		t.Error("the publication section renders before the correction is closed")
	}
}

// The pair the testing strategy asks of an enum-valued input: the chosen
// value is offered AND the other one is too, in the same case — a
// presence-only check passes over a select with one option, which is a
// dropdown that silently removes the professor's choice.
func TestThePublishFormOffersBothModes(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	body := f.detailBody(t, controlID)
	for _, mode := range []string{`value="real"`, `value="staging"`} {
		if !strings.Contains(body, mode) {
			t.Errorf("the mode selector does not offer %s", mode)
		}
	}
}

func TestPublicarIsDisabledWithAReasonWhenNoAccountIsConnected(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)
	f.rebuildWithGmail(t, connectedGmail{disconnected: true})

	body := f.detailBody(t, controlID)
	if !strings.Contains(body, "disabled>Publicar") {
		t.Error("Publicar is live for a professor who cannot send")
	}
	if !strings.Contains(body, "perfil") {
		t.Errorf("the disabled button gives no reason:\n%s", body)
	}
}

// A published control says what happened AND keeps the button (issue
// #287).
//
// The two were mutually exclusive while publishing was one-way. Now the
// button is how a professor finishes a partial run or re-sends a
// re-corrected copy, and removing it would leave them exactly where #273
// left Miguel: looking at a page that says a class was published and
// offering no way to write to the two people it missed.
func TestAPublishedControlShowsWhatHappenedAndKeepsTheButton(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	if rec := f.publish(t, controlID, url.Values{"mode": {"real"}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("publish: %d", rec.Code)
	}
	f.waitLatestJobTerminal(t, controlID)

	body := f.detailBody(t, controlID)
	if !strings.Contains(body, "Publicado el") {
		t.Errorf("the page does not say the control was published:\n%s", body)
	}
	if !strings.Contains(body, `action="/controls/`+controlID+`/publish"`) {
		t.Error("the publish form disappeared once the control was published; a partial run " +
			"can then never be finished")
	}
	// The line reads the COUNT, not just the mode. This fixture's copy is
	// matched to nobody, so the publication delivered nothing — and the
	// first version of this page told the professor "las correcciones se
	// enviaron a los estudiantes" permanently, with the zero sitting on the
	// same row (#273 review, NEW-3).
	if !strings.Contains(body, "no salió ningún correo") {
		t.Errorf("the published line claims delivery over a publication that delivered "+
			"nothing:\n%s", body)
	}
	if strings.Contains(body, "se enviaron a los estudiantes") {
		t.Error("the page says the students were written to over zero deliveries")
	}

	// And the count comes from the STAMPED READINGS, not from a column
	// somebody wrote once (issue #287). Stamping the copy is what a real
	// send does; the line must follow it.
	if _, err := f.db.ExecContext(context.Background(),
		"UPDATE reading SET published_at = 1757264400, published_grade = '5.7' "+
			"WHERE control_id = ? AND copy_number = 1",
		controlID); err != nil {
		t.Fatalf("stamping the copy: %v", err)
	}
	if body = f.detailBody(t, controlID); !strings.Contains(body, "salió 1 correo") {
		t.Errorf("the published line does not count the stamped copies:\n%s", body)
	}
}

// And the rehearsal survives it, because that is exactly when a professor
// needs it: a student has just said nothing arrived.
func TestTheRehearsalStaysAvailableAfterPublication(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	if rec := f.publish(t, controlID, url.Values{"mode": {"real"}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("publish: %d", rec.Code)
	}
	f.waitLatestJobTerminal(t, controlID)

	body := f.detailBody(t, controlID)
	if !strings.Contains(body, "/test-send") {
		t.Error("the rehearsal disappeared once the control was published")
	}
	if strings.Contains(body, "disabled>Enviar prueba") {
		t.Error("the rehearsal is disabled on a published control")
	}
}

// The gate the review added (PUB-2). Under `stub` or `dryrun` every send
// "succeeds", so before this the publication stamped the control, showed a
// green banner and told the professor the class had been written to — over
// nothing, irreversibly, and on the DEFAULT mode.
func TestPublishIsRefusedWhenThisServerCannotDeliver(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)
	f.rebuildWithDispatcher(t, email.NewStubDispatcher())

	rec := f.publish(t, controlID, url.Values{"mode": {"real"}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "NALANDA_EMAIL_MODE") {
		t.Errorf("the message does not name the variable an operator has to change:\n%s",
			rec.Body.String())
	}

	control, err := f.service.Get(context.Background(), controlID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if control.PublishedAt != nil {
		t.Error("a server that cannot send mail still stamped the control published")
	}
}

// And the rehearsal is still allowed under it: rehearsing on a server that
// delivers nothing is a coherent thing to do, and it changes no state.
func TestATestSendStillWorksWhenThisServerCannotDeliver(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)
	f.rebuildWithDispatcher(t, email.NewStubDispatcher())

	rec := f.testSend(t, controlID, url.Values{"to": {"miguel@gmail.com"}})
	if rec.Code != http.StatusSeeOther {
		t.Errorf("status = %d, want the rehearsal to proceed\n%s", rec.Code, rec.Body.String())
	}
}

// The escape hatch. Publication was one-way with no exceptions, so any run
// that stamped without delivering left the class permanently unreachable
// through the app.
// A staging run reached only the professor, and the published line must
// not credit it with reaching the class (#273 review, NEW-2).
//
// The count cannot tell the two apart — under `staging` every send genuinely
// succeeds, so the copies are stamped exactly as a real run stamps them —
// which is why the mode is read FIRST and the number never reaches this
// sentence.
func TestThePublishedLineDoesNotCreditAStagingRunWithReachingTheClass(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	if rec := f.publish(t, controlID, url.Values{"mode": {"staging"}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("publish: %d", rec.Code)
	}
	f.waitLatestJobTerminal(t, controlID)

	// A stamped copy, so the case cannot pass merely because nothing was
	// sent: the wording must come from the MODE and not from the count.
	if _, err := f.db.ExecContext(context.Background(),
		"UPDATE reading SET published_at = 1757264400, published_grade = '5.7' "+
			"WHERE control_id = ? AND copy_number = 1",
		controlID); err != nil {
		t.Fatalf("stamping the copy: %v", err)
	}

	body := f.detailBody(t, controlID)
	if !strings.Contains(body, "no a los estudiantes") {
		t.Errorf("the published line does not say a staging run reached no student:\n%s", body)
	}
	if strings.Contains(body, "correos a los estudiantes") {
		t.Error("the published line credits a staging run with reaching the class")
	}
}
