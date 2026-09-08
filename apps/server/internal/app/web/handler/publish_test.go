package handler_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
	"github.com/so77id/nalanda/apps/server/internal/infra/email"
)

// matchedGradedControl is gradedControl with a roster behind it, so copy 1
// is actually matched to somebody and its publication state is about the
// send rather than about a missing person.
func matchedGradedControl(t *testing.T, f *controlsFixture) string {
	t.Helper()

	if _, err := f.roster.Store.SaveRoster(context.Background(), f.courseID, []roster.SourceStudent{
		{FirstName: "Ana", LastName: "Pérez", RUT: "20100001", RUTDV: "5",
			CanvasUserID: "canvas-ana", Email: "ana@udp.cl"},
	}); err != nil {
		t.Fatalf("SaveRoster: %v", err)
	}
	controlID := gradedControl(t, f)
	// The corrected PDF, which the publication state asks about and which
	// the fake annotator does not put on the volume.
	if _, err := f.db.ExecContext(context.Background(), `
        INSERT INTO annotated_copy (control_id, copy_number, generated_at, path)
        VALUES (?, 1, 0, 'anotado-1.pdf')
        ON CONFLICT (control_id, copy_number) DO NOTHING`, controlID); err != nil {
		t.Fatalf("recording the annotated copy: %v", err)
	}
	return controlID
}

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

// The per-student send, from the review page (issue #287 §6).
//
// SYNCHRONOUS, unlike Publicar: one Gmail call and one PDF is a bounded
// third-party call the professor waits on, and they press it having just
// finished re-correcting somebody.

func (f *controlsFixture) publishCopy(t *testing.T, controlID string, copyNumber int) *httptest.ResponseRecorder {
	t.Helper()

	target := fmt.Sprintf("/controls/%s/copies/%d/publish", controlID, copyNumber)
	req := f.authedRequest(t, http.MethodPost, target, url.Values{})
	req.SetPathValue("id", controlID)
	req.SetPathValue("copy", strconv.Itoa(copyNumber))
	rec := httptest.NewRecorder()
	f.handler.PublishCopy(rec, req)
	return rec
}

// The fixture's single copy is matched to nobody, so the send is refused —
// with the reason, which is the whole point of distinguishing the three.
func TestPublishingOneCopyNamesWhyWhenThereIsNobodyToWriteTo(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	rec := f.publishCopy(t, controlID, 1)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "no está asociada") {
		t.Errorf("the refusal does not say the copy is matched to nobody:\n%s", rec.Body.String())
	}
}

func TestPublishingOneCopyRefusesAnOpenCorrection(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 2", 2)
	if err := f.service.AssignCourse(context.Background(), controlID, f.courseID); err != nil {
		t.Fatalf("AssignCourse: %v", err)
	}
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	rec := f.publishCopy(t, controlID, 1)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "cierra la corrección") {
		t.Errorf("the refusal does not say to close the correction first:\n%s", rec.Body.String())
	}
}

// AC9: refused under a transport that delivers nothing, the same gate the
// batch carries and for the same reason — under `stub` every send
// "succeeds", so without it the professor is told a student was written to
// over nothing.
func TestPublishingOneCopyIsRefusedWhenThisServerCannotDeliver(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)
	f.rebuildWithDispatcher(t, email.NewStubDispatcher())

	rec := f.publishCopy(t, controlID, 1)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "NALANDA_EMAIL_MODE") {
		t.Errorf("the refusal does not name the variable:\n%s", rec.Body.String())
	}
}

func TestPublishingOneCopyRefusesAProfessorWithNoConnectedAccount(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)
	f.rebuildWithGmail(t, connectedGmail{disconnected: true})

	rec := f.publishCopy(t, controlID, 1)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422\n%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "cuenta de Gmail") {
		t.Errorf("the refusal does not mention the missing account:\n%s", rec.Body.String())
	}
}

func TestPublishingACopyThatDoesNotExistIs404(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	rec := f.publishCopy(t, controlID, 99)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404\n%s", rec.Code, rec.Body.String())
	}
}

// The review page offers the button once the correction is closed, and not
// before: an open correction has no corrected PDF to attach and no settled
// grade to quote.
func TestTheReviewPageOffersThePerStudentSendOnlyOnAClosedCorrection(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 2", 2)
	if err := f.service.AssignCourse(context.Background(), controlID, f.courseID); err != nil {
		t.Fatalf("AssignCourse: %v", err)
	}
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	target := fmt.Sprintf("/controls/%s/copies/1/publish", controlID)
	if body := reviewBody(t, f, controlID, 1); strings.Contains(body, target) {
		t.Error("the review page offers the per-student send while the correction is still open")
	}

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/close", nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.CloseCorrection(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("close status = %d, want 303", rec.Code)
	}

	body := reviewBody(t, f, controlID, 1)
	if !strings.Contains(body, `action="`+target+`"`) {
		t.Errorf("the review page does not offer the per-student send once closed:\n%s", body)
	}
	if !strings.Contains(body, "Enviar la corrección a esta persona") {
		t.Errorf("the button has no label a professor can read:\n%s", body)
	}
}

// And once a copy has gone out, the page says so — read off the copy's own
// two columns, with no roster lookup: "what did this person receive" is a
// question the copy answers by itself.
func TestTheReviewPageSaysWhenThisCopyWentOut(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	if _, err := f.db.ExecContext(context.Background(),
		"UPDATE reading SET published_at = 1757264400, published_grade = '5.7' "+
			"WHERE control_id = ? AND copy_number = 1", controlID); err != nil {
		t.Fatalf("stamping the copy: %v", err)
	}

	body := reviewBody(t, f, controlID, 1)
	if !strings.Contains(body, "Enviada el") || !strings.Contains(body, "5.7") {
		t.Errorf("the review page does not say what this copy was sent with:\n%s", body)
	}
}

// The copies table's "Envío" column (issue #287 §7).
//
// PublishResult.Skipped was computed on every run and surfaced nowhere, so
// the professor's only signal that two people got nothing was comparing
// "salieron N correos" against their own class list, after the fact.

func TestTheCopiesTableNamesWhyACopyWasSkipped(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	// This fixture's copy is matched to nobody, which is the first of the
	// three reasons and the one a professor acts on from the review page.
	body := f.detailBody(t, controlID)
	if !strings.Contains(body, "<th>Envío</th>") {
		t.Fatalf("the copies table has no publication column:\n%s", body)
	}
	if !strings.Contains(body, "omitida") {
		t.Errorf("the table does not say the copy was skipped:\n%s", body)
	}
	if !strings.Contains(body, "no está asociada a nadie del curso") {
		t.Errorf("the table does not say WHY the copy was skipped:\n%s", body)
	}
}

// A copy that went out says so, with when and with what — and a copy whose
// grade has since moved says both numbers, because the whole sentence is
// the comparison.
func TestTheCopiesTableShowsSentAndStaleCopies(t *testing.T) {
	f := newControlsFixture(t)
	controlID := matchedGradedControl(t, f)

	if _, err := f.db.ExecContext(context.Background(),
		"UPDATE reading SET published_at = 1757264400, published_grade = '7.0' "+
			"WHERE control_id = ? AND copy_number = 1", controlID); err != nil {
		t.Fatalf("stamping the copy: %v", err)
	}
	// 1757264400 is 2025-09-07T17:00:00Z, and scanReading reads the column
	// back in UTC, so the cell is that instant and not the test machine's.
	body := f.detailBody(t, controlID)
	if !strings.Contains(body, "07-09-2025 17:00, con un 7.0") {
		t.Errorf("the table does not say when the copy went out and with what:\n%s", body)
	}

	// And now the grade it went out with is not the grade it has.
	if _, err := f.db.ExecContext(context.Background(),
		"UPDATE reading SET published_grade = '4.0' WHERE control_id = ? AND copy_number = 1",
		controlID); err != nil {
		t.Fatalf("moving the sent grade: %v", err)
	}
	body = f.detailBody(t, controlID)
	if !strings.Contains(body, "desactualizada") {
		t.Errorf("the table does not flag a copy whose grade moved after its send:\n%s", body)
	}
	if !strings.Contains(body, "salió con un 4.0, ahora tiene un 7.0") {
		t.Errorf("the table does not show both grades of a stale copy:\n%s", body)
	}
}

// AC10: no name and no address reaches the publication column.
//
// The "Alumno" column names a person — that is #272's decision and it
// stands — but nothing in the send cell does, the same rule publishDetail
// follows one layer down (docs/security-notes.md §"Logs and personal
// data").
func TestThePublicationColumnCarriesNoAddress(t *testing.T) {
	f := newControlsFixture(t)
	controlID := matchedGradedControl(t, f)

	body := f.detailBody(t, controlID)
	if strings.Contains(body, "@") && strings.Contains(body, "envio-") {
		// Narrow the claim to the cells themselves rather than to the whole
		// page, which legitimately carries the professor's own address in
		// the shell.
		for _, cell := range publicationCells(body) {
			if strings.Contains(cell, "@") {
				t.Errorf("a publication cell carries an address: %q", cell)
			}
		}
	}
}

// publicationCells pulls the rendered send cells out of the page, so a case
// can assert about them without asserting about the whole document.
func publicationCells(body string) []string {
	var out []string
	rest := body
	for {
		i := strings.Index(rest, `<td class="envio-`)
		if i < 0 {
			return out
		}
		rest = rest[i:]
		j := strings.Index(rest, "</td>")
		if j < 0 {
			return out
		}
		out = append(out, rest[:j])
		rest = rest[j:]
	}
}

// An open correction shows no column at all: every copy would read
// "omitida: no tiene su PDF corregido", which is thirty cells saying the
// same thing about a step nobody has reached.
func TestAnOpenCorrectionShowsNoPublicationColumn(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 2", 2)
	if err := f.service.AssignCourse(context.Background(), controlID, f.courseID); err != nil {
		t.Fatalf("AssignCourse: %v", err)
	}
	f.fake.AnalyzeReports = []controls.Report{
		{Copies: map[string]controls.ReportCopy{"1": okCopy("20100001")}},
	}
	uploadOnce(t, f, controlID)

	if body := f.detailBody(t, controlID); strings.Contains(body, "<th>Envío</th>") {
		t.Errorf("the publication column renders on an open correction:\n%s", body)
	}
}
