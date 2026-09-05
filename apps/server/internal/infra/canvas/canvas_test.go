package canvas_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	domaincanvas "github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/infra/canvas"
)

// A fake Canvas, the way oidctest.Provider is a fake Google. Nothing here
// reaches the real UDP Canvas — that is a human's check (issue #271 S8), for
// the same reason GOOGLE-CHECK.md exists.

const token = "1234~AbCdEfGhIjKlMnOpQrStUvWxYz"

// fakeCanvas records what it was asked and answers what the case tells it
// to.
type fakeCanvas struct {
	status int
	body   string

	gotAuth        string
	gotContentType string
	gotMethod      string
	gotQuery       string
	calls          int
}

func (f *fakeCanvas) start(t *testing.T) string {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls++
		f.gotMethod = r.Method
		f.gotAuth = r.Header.Get("Authorization")
		f.gotContentType = r.Header.Get("Content-Type")

		raw, _ := io.ReadAll(r.Body)
		var payload struct {
			Query string `json:"query"`
		}
		_ = json.Unmarshal(raw, &payload)
		f.gotQuery = payload.Query

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(f.status)
		_, _ = io.WriteString(w, f.body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestVerifyAcceptsATokenCanvasAnswersFor(t *testing.T) {
	fake := &fakeCanvas{status: http.StatusOK, body: `{"data":{"__typename":"Query"}}`}
	client := canvas.New(fake.start(t))

	if err := client.Verify(context.Background(), token); err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if fake.gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", fake.gotMethod)
	}
	if want := "Bearer " + token; fake.gotAuth != want {
		t.Errorf("Authorization = %q, want %q", fake.gotAuth, want)
	}
	if fake.gotContentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", fake.gotContentType)
	}
	// The verification asks nothing of Canvas's own schema, so it cannot
	// break when Canvas changes its types.
	if !strings.Contains(fake.gotQuery, "__typename") {
		t.Errorf("query = %q, want the schema-independent __typename probe", fake.gotQuery)
	}
}

// 401 and 403 are the only two answers that mean "this token is bad". They
// are the only two that let the caller store nothing AND tell the professor
// to paste another one.
func TestVerifyRejectsTheTokenOnlyOnAnAuthenticationStatus(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			fake := &fakeCanvas{status: status, body: `{"errors":[{"message":"user authorization required"}]}`}
			client := canvas.New(fake.start(t))

			err := client.Verify(context.Background(), token)
			if !errors.Is(err, domaincanvas.ErrTokenRejected) {
				t.Errorf("Verify returned %v, want ErrTokenRejected", err)
			}
			if errors.Is(err, domaincanvas.ErrUnavailable) {
				t.Error("a rejection also matched ErrUnavailable; the two must stay apart")
			}
		})
	}
}

// Everything else says nothing about the token. Reporting any of these as a
// rejection would tell a professor with a perfectly good token to go and
// generate another one.
func TestVerifyReportsUnavailableForEveryAnswerThatIsNotAboutTheToken(t *testing.T) {
	for _, c := range []struct {
		name   string
		status int
		body   string
	}{
		{"a 500 from Canvas", http.StatusInternalServerError, `{"errors":[{"message":"boom"}]}`},
		{"a 502 from a proxy", http.StatusBadGateway, `<html>gateway</html>`},
		{"a 429 rate limit", http.StatusTooManyRequests, `{"errors":[{"message":"rate limited"}]}`},
		{"a 200 with a body that is not JSON", http.StatusOK, `<html>maintenance</html>`},
		{"a 200 carrying GraphQL errors", http.StatusOK, `{"errors":[{"message":"__typename is disabled"}]}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			fake := &fakeCanvas{status: c.status, body: c.body}
			client := canvas.New(fake.start(t))

			err := client.Verify(context.Background(), token)
			if !errors.Is(err, domaincanvas.ErrUnavailable) {
				t.Errorf("Verify returned %v, want ErrUnavailable", err)
			}
			if errors.Is(err, domaincanvas.ErrTokenRejected) {
				t.Error("an unreadable answer was reported as a rejected token")
			}
		})
	}
}

// A Canvas that is not there at all: the connection itself fails. Same
// verdict as an unreadable answer, and worth its own case because it takes a
// different branch (the transport error rather than a status).
func TestVerifyReportsUnavailableWhenCanvasCannotBeReached(t *testing.T) {
	// A server started and immediately closed leaves a port nothing is
	// listening on — a refused connection rather than a timeout, so the
	// case is fast and deterministic.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close()

	err := canvas.New(url).Verify(context.Background(), token)
	if !errors.Is(err, domaincanvas.ErrUnavailable) {
		t.Errorf("Verify returned %v, want ErrUnavailable", err)
	}
}

// A cancelled request is the professor closing the tab, not a bad token.
func TestVerifyHonoursTheContext(t *testing.T) {
	fake := &fakeCanvas{status: http.StatusOK, body: `{"data":{"__typename":"Query"}}`}
	client := canvas.New(fake.start(t))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := client.Verify(ctx, token)
	if !errors.Is(err, domaincanvas.ErrUnavailable) {
		t.Errorf("Verify on a cancelled context returned %v, want ErrUnavailable", err)
	}
	if fake.calls != 0 {
		t.Errorf("Canvas was called %d times on a cancelled context, want 0", fake.calls)
	}
}

// The token travels in a header, so no error this package builds can carry
// it — not the transport failure, not the status branches, not the
// unreadable body. An error string reaches stderr and stderr reaches
// whatever collects container logs.
func TestNoErrorEverCarriesTheToken(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close()

	cases := map[string]func() error{
		"canvas is unreachable": func() error {
			return canvas.New(deadURL).Verify(context.Background(), token)
		},
	}
	for _, c := range []struct {
		name   string
		status int
		body   string
	}{
		{"canvas rejects it", http.StatusUnauthorized, `{"errors":[{"message":"user authorization required"}]}`},
		{"canvas answers 500", http.StatusInternalServerError, `{"errors":[{"message":"boom"}]}`},
		{"canvas answers unparseable json", http.StatusOK, `<html>`},
		{"canvas answers 200 with graphql errors", http.StatusOK, `{"errors":[{"message":"nope"}]}`},
	} {
		fake := &fakeCanvas{status: c.status, body: c.body}
		url := fake.start(t)
		cases[c.name] = func() error { return canvas.New(url).Verify(context.Background(), token) }
	}

	for name, call := range cases {
		t.Run(name, func(t *testing.T) {
			err := call()
			if err == nil {
				t.Fatal("the call succeeded, so this case verified nothing")
			}
			if strings.Contains(err.Error(), token) {
				t.Errorf("the error carries the token: %v", err)
			}
			// Not even a prefix of it: a truncated credential in a log is
			// still a credential in a log.
			if strings.Contains(err.Error(), token[:12]) {
				t.Errorf("the error carries part of the token: %v", err)
			}
		})
	}
}

// An empty endpoint falls back to UDP's, so a deployment that does not set
// the variable still talks to the right Canvas.
func TestAnEmptyEndpointFallsBackToUDPCanvas(t *testing.T) {
	if canvas.DefaultEndpoint != "https://udp.instructure.com/api/graphql" {
		t.Errorf("DefaultEndpoint = %q, want UDP's Canvas GraphQL endpoint", canvas.DefaultEndpoint)
	}
	if canvas.New("") == nil {
		t.Error("New(\"\") returned nil")
	}
}

// --- Courses and Roster (S4) ---------------------------------------------
//
// The bodies below are the SHAPE the S4 spike measured against the real UDP
// Canvas on 2026-09-04 (ADR-0069), with the students' own data replaced:
// the field names, the nesting and the `sisId` format are Canvas's, the
// names and numbers are not anybody's.

// jsonCanvas answers a scripted sequence of bodies, one per request, so a
// case can drive the pagination loop.
type jsonCanvas struct {
	bodies []string
	calls  int
	vars   []map[string]any
}

func (j *jsonCanvas) start(t *testing.T) string {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var payload struct {
			Variables map[string]any `json:"variables"`
		}
		_ = json.Unmarshal(raw, &payload)
		j.vars = append(j.vars, payload.Variables)

		body := `{"data":null}`
		if j.calls < len(j.bodies) {
			body = j.bodies[j.calls]
		}
		j.calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestCoursesReadsTheFieldsThePickerNeeds(t *testing.T) {
	fake := &jsonCanvas{bodies: []string{`{"data":{"allCourses":[
      {"_id":"44779","name":"ESTRUCTURAS DE DATOS Y ALGORITMOS","courseCode":"CIT2006_CA01",
       "term":{"name":"2026-2","startAt":"2026-07-14T00:00:00-04:00"}},
      {"_id":"47743","name":"Inducción a la docencia","courseCode":"Segundo semestre 2026",
       "term":{"name":"Período predeterminado","startAt":null}},
      {"_id":"23334","name":"ESTRUCTURAS DE DATOS Y ALGORITMOS","courseCode":"CIT2006_CA01",
       "term":{"name":"2023-2","startAt":"2023-07-19T00:00:00-04:00"}}
    ]}}`}}

	courses, err := canvas.New(fake.start(t)).Courses(context.Background(), token)
	if err != nil {
		t.Fatalf("Courses: %v", err)
	}
	if len(courses) != 3 {
		t.Fatalf("got %d courses, want 3", len(courses))
	}

	first := courses[0]
	if first.CanvasID != "44779" || first.Code != "CIT2006_CA01" || first.Term != "2026-2" {
		t.Errorf("first course = %+v, want the 2026-2 CIT2006", first)
	}
	if first.TermStart != "2026-07-14T00:00:00-04:00" {
		t.Errorf("TermStart = %q, want the term's start as Canvas sends it", first.TermStart)
	}
	// A course in Canvas's default term has a term with a null startAt.
	// Measured: the professor has two of these. Neither may crash the
	// picker nor be dropped from it.
	if courses[1].Term != "Período predeterminado" || courses[1].TermStart != "" {
		t.Errorf("default-term course = %+v, want its name and an empty start", courses[1])
	}
}

// A course with no term at all — `term: null` rather than a term with a null
// start. Not observed in the spike, and a nil dereference if the client
// assumed the object is always there.
func TestCoursesSurvivesACourseWithNoTerm(t *testing.T) {
	fake := &jsonCanvas{bodies: []string{
		`{"data":{"allCourses":[{"_id":"1","name":"X","courseCode":"X","term":null}]}}`}}

	courses, err := canvas.New(fake.start(t)).Courses(context.Background(), token)
	if err != nil {
		t.Fatalf("Courses: %v", err)
	}
	if len(courses) != 1 || courses[0].Term != "" || courses[0].TermStart != "" {
		t.Errorf("got %+v, want one course with an empty term", courses)
	}
}

func TestRosterNormalisesTheStudentsAndSkipsStaff(t *testing.T) {
	fake := &jsonCanvas{bodies: []string{`{"data":{"course":{"enrollmentsConnection":{
      "pageInfo":{"hasNextPage":false,"endCursor":null},
      "nodes":[
        {"_id":"800001","type":"StudentEnrollment","state":"active",
         "user":{"_id":"900001","sortableName":"PEREZ SOTO, ANA MARÍA",
                 "email":"ANA.CAMUS1@MAIL.UDP.CL","sisId":"112223335"}},
        {"_id":"800003","type":"StudentEnrollment","state":"active",
         "user":{"_id":"900002","sortableName":"MUÑOZ ÁVILA, ELENA SOFÍA",
                 "email":"ELENA.SANCHEZ2@MAIL.UDP.CL","sisId":"11222444K"}},
        {"_id":"9","type":"TeacherEnrollment","state":"active",
         "user":{"_id":"1","sortableName":"RODRÍGUEZ, MIGUEL","email":"m@udp.cl","sisId":"111111111"}},
        {"_id":"10","type":"TaEnrollment","state":"active",
         "user":{"_id":"2","sortableName":"AYUDANTE, UN","email":"a@udp.cl","sisId":"222222222"}}
      ]}}}}`}}

	students, err := canvas.New(fake.start(t)).Roster(context.Background(), token, "44779")
	if err != nil {
		t.Fatalf("Roster: %v", err)
	}
	if len(students) != 2 {
		t.Fatalf("got %d students, want 2 — the teacher and the TA are not students", len(students))
	}

	first := students[0]
	if first.FirstName != "ANA MARÍA" || first.LastName != "PEREZ SOTO" {
		t.Errorf("name split = %q / %q, want the sortableName's two halves", first.FirstName, first.LastName)
	}
	if first.RUT != "11222333" || first.RUTDV != "5" {
		t.Errorf("RUT = %q-%q, want 11222333-5 (the sisId with its verifier taken off)", first.RUT, first.RUTDV)
	}
	if first.CanvasUserID != "900001" || first.CanvasEnrollmentID != "800001" {
		t.Errorf("canvas ids = %q / %q", first.CanvasUserID, first.CanvasEnrollmentID)
	}
	// K is a real verifier — four of the twenty-five measured had one.
	if students[1].RUT != "11222444" || students[1].RUTDV != "K" {
		t.Errorf("K-verifier student = %q-%q, want 11222444-K", students[1].RUT, students[1].RUTDV)
	}
}

// The case the spike proved is necessary: 15 pages of 2 returned 29 unique
// enrolments against the real Canvas. A paginator that stopped at the first
// page would return half a class and look exactly like a class where half
// the students dropped out.
func TestRosterFollowsEveryPage(t *testing.T) {
	page := func(id string, hasNext bool, cursor string) string {
		next := "false"
		if hasNext {
			next = "true"
		}
		return `{"data":{"course":{"enrollmentsConnection":{
          "pageInfo":{"hasNextPage":` + next + `,"endCursor":"` + cursor + `"},
          "nodes":[{"_id":"e` + id + `","type":"StudentEnrollment","state":"active",
            "user":{"_id":"u` + id + `","sortableName":"APELLIDO, NOMBRE",
                    "email":"x@mail.udp.cl","sisId":"2231706` + id + `5"}}]}}}}`
	}
	fake := &jsonCanvas{bodies: []string{
		page("1", true, "cursor-1"),
		page("2", true, "cursor-2"),
		page("3", false, ""),
	}}

	students, err := canvas.New(fake.start(t)).Roster(context.Background(), token, "44779")
	if err != nil {
		t.Fatalf("Roster: %v", err)
	}
	if len(students) != 3 {
		t.Fatalf("got %d students across 3 pages, want 3", len(students))
	}
	if fake.calls != 3 {
		t.Errorf("made %d requests, want 3", fake.calls)
	}

	// The cursor each page reported is what the next request carried —
	// a paginator that re-sent the same `after` would loop on page one
	// forever and still return "some" students.
	if got := fake.vars[0]["after"]; got != nil {
		t.Errorf("first request sent after=%v, want null", got)
	}
	if got := fake.vars[1]["after"]; got != "cursor-1" {
		t.Errorf("second request sent after=%v, want cursor-1", got)
	}
	if got := fake.vars[2]["after"]; got != "cursor-2" {
		t.Errorf("third request sent after=%v, want cursor-2", got)
	}
	// And the course id travels as a variable rather than being spliced
	// into the query text.
	if got := fake.vars[0]["courseId"]; got != "44779" {
		t.Errorf("courseId variable = %v, want 44779", got)
	}
}

// hasNextPage with no cursor would repeat one page forever. Refusing beats
// looping, and beats returning a partial roster as if it were the class.
func TestRosterRefusesAnotherPageWithNoCursor(t *testing.T) {
	fake := &jsonCanvas{bodies: []string{`{"data":{"course":{"enrollmentsConnection":{
      "pageInfo":{"hasNextPage":true,"endCursor":""},
      "nodes":[{"_id":"1","type":"StudentEnrollment","state":"active",
        "user":{"_id":"1","sortableName":"A, B","email":"x@y","sisId":"112223335"}}]}}}}`}}

	_, err := canvas.New(fake.start(t)).Roster(context.Background(), token, "44779")
	if !errors.Is(err, domaincanvas.ErrUnavailable) {
		t.Errorf("Roster returned %v, want ErrUnavailable", err)
	}
}

// A student whose sisId cannot be read is imported WITHOUT a RUT rather
// than skipped or guessed: an unmatchable person is a visible gap on the
// roster page, and a guessed RUT would be a wrong match on somebody's
// grades (ADR-0069 §Decision 2).
func TestRosterKeepsAStudentWhoseRutCannotBeRead(t *testing.T) {
	fake := &jsonCanvas{bodies: []string{`{"data":{"course":{"enrollmentsConnection":{
      "pageInfo":{"hasNextPage":false,"endCursor":null},
      "nodes":[{"_id":"1","type":"StudentEnrollment","state":"active",
        "user":{"_id":"1","sortableName":"EXTRANJERA, UNA","email":"x@mail.udp.cl","sisId":"AB1234567"}}]}}}}`}}

	students, err := canvas.New(fake.start(t)).Roster(context.Background(), token, "44779")
	if err != nil {
		t.Fatalf("Roster: %v", err)
	}
	if len(students) != 1 {
		t.Fatalf("got %d students, want the unmatchable one kept", len(students))
	}
	if students[0].HasRUT() {
		t.Errorf("RUT = %q-%q, want none", students[0].RUT, students[0].RUTDV)
	}
	if students[0].LastName != "EXTRANJERA" || students[0].Email != "x@mail.udp.cl" {
		t.Errorf("the rest of the row was lost with the RUT: %+v", students[0])
	}
}

// A null course is an id this token cannot see. Kept apart from an EMPTY
// roster, which is a real course with nobody enrolled yet — the import
// renders those two very differently.
func TestRosterDistinguishesAnUnknownCourseFromAnEmptyOne(t *testing.T) {
	unknown := &jsonCanvas{bodies: []string{`{"data":{"course":null}}`}}
	if _, err := canvas.New(unknown.start(t)).Roster(context.Background(), token, "999"); !errors.Is(err, domaincanvas.ErrCourseNotFound) {
		t.Errorf("an unknown course returned %v, want ErrCourseNotFound", err)
	}

	empty := &jsonCanvas{bodies: []string{`{"data":{"course":{"enrollmentsConnection":{
      "pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}`}}
	students, err := canvas.New(empty.start(t)).Roster(context.Background(), token, "44779")
	if err != nil {
		t.Fatalf("an empty course returned %v, want no error", err)
	}
	if len(students) != 0 {
		t.Errorf("got %d students from an empty course", len(students))
	}
}

// A 200 carrying GraphQL errors is refused for the data queries, not just
// for the probe: a partial GraphQL answer carries both `data` and `errors`,
// and importing the half that arrived would be a roster missing whoever the
// error was about.
func TestCoursesAndRosterRefuseAPartialGraphQLAnswer(t *testing.T) {
	body := `{"data":{"allCourses":[{"_id":"1","name":"X","courseCode":"X","term":null}]},
             "errors":[{"message":"Insufficient permissions"}]}`

	fake := &jsonCanvas{bodies: []string{body}}
	if _, err := canvas.New(fake.start(t)).Courses(context.Background(), token); !errors.Is(err, domaincanvas.ErrUnavailable) {
		t.Errorf("Courses returned %v, want ErrUnavailable", err)
	}

	fake2 := &jsonCanvas{bodies: []string{body}}
	if _, err := canvas.New(fake2.start(t)).Roster(context.Background(), token, "1"); !errors.Is(err, domaincanvas.ErrUnavailable) {
		t.Errorf("Roster returned %v, want ErrUnavailable", err)
	}
}

// A revoked token surfaces as a rejection on the data calls too, not as an
// outage: the professor's fix is to paste a new one.
func TestCoursesAndRosterReportARevokedTokenAsRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"errors":[{"message":"user authorization required"}]}`)
	}))
	t.Cleanup(srv.Close)

	client := canvas.New(srv.URL)
	if _, err := client.Courses(context.Background(), token); !errors.Is(err, domaincanvas.ErrTokenRejected) {
		t.Errorf("Courses returned %v, want ErrTokenRejected", err)
	}
	if _, err := client.Roster(context.Background(), token, "1"); !errors.Is(err, domaincanvas.ErrTokenRejected) {
		t.Errorf("Roster returned %v, want ErrTokenRejected", err)
	}
}

// --- Review fixes (#271 review) ------------------------------------------

// COR-4. The pagination cap had no test at all: setting it to 1<<40 left
// the whole suite green. Its job is to stop an infinite loop inside a
// request a professor is waiting on, which is exactly the class of guard
// that must be exercised — an off-by-one here stays invisible up to the
// moment a misbehaving Canvas hangs a handler.
//
// The call count is asserted as well as the error: without it, an
// off-by-one in the cap would still pass.
func TestRosterStopsAtThePageCapRatherThanLoopingForever(t *testing.T) {
	forever := `{"data":{"course":{"enrollmentsConnection":{
      "pageInfo":{"hasNextPage":true,"endCursor":"always-another"},
      "nodes":[{"_id":"1","type":"StudentEnrollment","state":"active",
        "user":{"_id":"1","sortableName":"A, B","email":"x@y","sisId":"112223335"}}]}}}}`

	bodies := make([]string, 200)
	for i := range bodies {
		bodies[i] = forever
	}
	fake := &jsonCanvas{bodies: bodies}

	_, err := canvas.New(fake.start(t)).Roster(context.Background(), token, "44779")
	if !errors.Is(err, domaincanvas.ErrUnavailable) {
		t.Fatalf("Roster returned %v, want ErrUnavailable at the cap", err)
	}
	if fake.calls != 100 {
		t.Errorf("made %d requests before giving up, want exactly the 100-page cap", fake.calls)
	}
}

// COR-5. The enrolment's Canvas `state` was fetched and never read, so a
// student Canvas had marked `completed` or `deleted` was imported as
// enrolled — and would have become a grade recipient in WP-2. Only `active`
// and `invited` mean "on the course"; everything else is a person the
// import must leave out, which is what lets the withdraw step stamp them.
func TestRosterKeepsOnlyTheEnrolmentStatesThatMeanOnTheCourse(t *testing.T) {
	node := func(id, state string) string {
		return `{"_id":"e` + id + `","type":"StudentEnrollment","state":"` + state + `",
          "user":{"_id":"u` + id + `","sortableName":"APELLIDO` + id + `, NOMBRE",
                  "email":"x@mail.udp.cl","sisId":"2231706` + id + `5"}}`
	}
	fake := &jsonCanvas{bodies: []string{`{"data":{"course":{"enrollmentsConnection":{
      "pageInfo":{"hasNextPage":false,"endCursor":null},
      "nodes":[` + node("1", "active") + `,` + node("2", "invited") + `,` +
		node("3", "completed") + `,` + node("4", "deleted") + `,` +
		node("5", "inactive") + `,` + node("6", "rejected") + `]}}}}`}}

	students, err := canvas.New(fake.start(t)).Roster(context.Background(), token, "44779")
	if err != nil {
		t.Fatalf("Roster: %v", err)
	}
	if len(students) != 2 {
		t.Fatalf("got %d students, want the active and the invited one only: %+v", len(students), students)
	}
	for _, s := range students {
		if s.CanvasUserID != "u1" && s.CanvasUserID != "u2" {
			t.Errorf("%s was imported; only active and invited enrolments are on the course", s.CanvasUserID)
		}
	}
}

// COR-8's other half: the client reports what Canvas said, duplicates
// included. De-duplication lives in coursestore.SaveRoster, where the
// roster becomes a set of people and where ImportResult is computed — two
// answers to "is this one person or two" is how the two drift apart.
func TestRosterReportsAPersonCanvasListedTwice(t *testing.T) {
	node := `{"_id":"e1","type":"StudentEnrollment","state":"active",
      "user":{"_id":"900001","sortableName":"PEREZ SOTO, ANA",
              "email":"x@mail.udp.cl","sisId":"112223335"}}`
	fake := &jsonCanvas{bodies: []string{`{"data":{"course":{"enrollmentsConnection":{
      "pageInfo":{"hasNextPage":false,"endCursor":null},
      "nodes":[` + node + `,` + node + `]}}}}`}}

	students, err := canvas.New(fake.start(t)).Roster(context.Background(), token, "44779")
	if err != nil {
		t.Fatalf("Roster: %v", err)
	}
	if len(students) != 2 {
		t.Errorf("got %d students; this layer passes duplicates through on purpose", len(students))
	}
}
