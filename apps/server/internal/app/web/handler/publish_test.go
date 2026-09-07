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

// 409, not 422: the request is well-formed and the professor is allowed to
// make it. The resource is already in the state they asked for, and
// publication is one-way in v1.
func TestASecondPublishAnswers409(t *testing.T) {
	f := newControlsFixture(t)
	controlID := gradedControl(t, f)

	if rec := f.publish(t, controlID, url.Values{"mode": {"real"}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("the first publish: %d", rec.Code)
	}
	f.waitLatestJobTerminal(t, controlID)

	rec := f.publish(t, controlID, url.Values{"mode": {"real"}})
	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409\n%s", rec.Code, rec.Body.String())
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
