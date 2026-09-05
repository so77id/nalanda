// Package canvas is the HTTP adapter for Canvas's GraphQL endpoint. It
// satisfies canvas.API, declared in internal/domain/canvas.
//
// Everything here speaks one protocol: a POST of `{"query": …}` to
// `<endpoint>` carrying `Authorization: Bearer <token>`. The token is a
// PARAMETER of every call and never state on the client — this client is a
// process-wide singleton shared by every professor, and a credential stored
// on it would outlive the request that decrypted it and be reachable by the
// next request, whoever it belongs to.
//
// Nothing in this package logs, wraps or formats a token. An error string
// reaches stderr and stderr reaches whatever collects container logs; the
// rule is the same one config.SafeDatabaseURL follows, and
// TestNoErrorEverCarriesTheToken is what pins it.
package canvas

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	domaincanvas "github.com/so77id/nalanda/apps/server/internal/domain/canvas"
)

// DefaultEndpoint is UDP's Canvas GraphQL endpoint — the one this server
// talks to in production. Overridable through configuration so a test can
// point at an httptest server and a second institution costs no code.
const DefaultEndpoint = "https://udp.instructure.com/api/graphql"

// defaultTimeout bounds one Canvas call.
//
// Canvas is a third party on the far side of the professor's network, and
// this client is called from an HTTP handler the professor is waiting on.
// Without a deadline, a Canvas that accepts the connection and never answers
// holds that handler open indefinitely — the same failure the server's own
// five explicit timeouts exist to prevent, one layer out.
const defaultTimeout = 15 * time.Second

// Client is the adapter.
type Client struct {
	endpoint string
	http     *http.Client
}

// New returns a Client posting to endpoint. An empty endpoint means
// DefaultEndpoint.
func New(endpoint string) *Client {
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	return &Client{
		endpoint: endpoint,
		http:     &http.Client{Timeout: defaultTimeout},
	}
}

// The domain's interface, satisfied at compile time — the storage.Prober
// shape.
var _ domaincanvas.API = (*Client)(nil)

// verifyQuery is the smallest question that proves a token authenticates.
//
// `__typename` is a GraphQL meta-field available on every schema by
// definition, so this asks nothing of Canvas's own types and cannot break
// when Canvas changes them. What is being read is not the answer but the
// STATUS: Canvas refuses an unusable token with 401 before any query runs.
//
// Deliberately not a real data query: a verification that fetched courses
// would report "invalid token" for a professor whose courses this server
// cannot see, which is a different problem with the same message.
const verifyQuery = `query { __typename }`

// Verify reports whether the token authenticates against Canvas.
//
// The three outcomes are kept strictly apart, because the caller stores the
// token on exactly one of them:
//
//   - nil — Canvas answered 2xx with no GraphQL errors.
//   - ErrTokenRejected — Canvas answered 401 or 403. The token is bad and
//     the professor has to paste another one.
//   - ErrUnavailable — anything else: a transport failure, a 5xx, a body
//     this client cannot read, or a 200 carrying GraphQL errors. None of
//     those says anything about the token, and the caller must not store it
//     on the strength of a maybe.
func (c *Client) Verify(ctx context.Context, token string) error {
	status, body, err := c.post(ctx, token, verifyQuery, nil)
	switch {
	case err != nil:
		return fmt.Errorf("%w: %v", domaincanvas.ErrUnavailable, err)
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return fmt.Errorf("%w: Canvas answered %d", domaincanvas.ErrTokenRejected, status)
	case status < 200 || status > 299:
		return fmt.Errorf("%w: Canvas answered %d", domaincanvas.ErrUnavailable, status)
	}

	var answer struct {
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &answer); err != nil {
		return fmt.Errorf("%w: Canvas answered %d with a body this client cannot read", domaincanvas.ErrUnavailable, status)
	}
	if len(answer.Errors) > 0 {
		// A 200 carrying GraphQL errors is an answer about the QUERY, not
		// about the token — Canvas rejects a bad token with a status, not
		// with an error entry. Reporting this as a rejection would tell a
		// professor their working token is invalid.
		return fmt.Errorf("%w: Canvas answered 200 with %d GraphQL error(s), the first being %q",
			domaincanvas.ErrUnavailable, len(answer.Errors), answer.Errors[0].Message)
	}
	return nil
}

// post sends one GraphQL query and returns the status and the body.
//
// It returns the body rather than a decoded value so each caller decodes
// into its own shape, and it returns the STATUS rather than mapping it,
// because "which status means what" is a per-call decision — Verify treats
// a 401 as an answer about the token, and a future Roster call treats it as
// an answer about a token that has since been revoked.
func (c *Client) post(ctx context.Context, token, query string, variables map[string]any) (int, []byte, error) {
	payload, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return 0, nil, fmt.Errorf("encode the query: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		// The error from NewRequestWithContext can carry the URL but never
		// the header, so no token can reach this string.
		return 0, nil, fmt.Errorf("build the request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// url.Error prints the request URL, which carries no credential —
		// the token travels in a header. Pinned by
		// TestNoErrorEverCarriesTheToken.
		return 0, nil, fmt.Errorf("reach Canvas at %s: %w", c.endpoint, err)
	}
	defer func() { _ = resp.Body.Close() }()

	// Bounded: a third party that answers with an endless body must not be
	// able to exhaust this server's memory. 8 MiB is far beyond any roster
	// a course will ever have and far below anything that hurts.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("read Canvas's answer: %w", err)
	}
	return resp.StatusCode, body, nil
}

// coursesQuery lists the courses the token's owner is enrolled in.
//
// The field set is exactly what the picker renders plus what orders it.
// `term.startAt` is fetched only to sort by: Canvas sends it as RFC 3339,
// which sorts correctly as a string, so nothing here parses a timestamp
// whose one job is to put 2026-2 above 2023-1 (ADR-0069 §Decision 5).
const coursesQuery = `query { allCourses { _id name courseCode term { name startAt } } }`

// Courses lists the courses the token's owner is enrolled in, in any role.
func (c *Client) Courses(ctx context.Context, token string) ([]domaincanvas.Course, error) {
	var answer struct {
		Data struct {
			AllCourses []struct {
				ID         string `json:"_id"`
				Name       string `json:"name"`
				CourseCode string `json:"courseCode"`
				Term       *struct {
					Name    string `json:"name"`
					StartAt string `json:"startAt"`
				} `json:"term"`
			} `json:"allCourses"`
		} `json:"data"`
	}
	if err := c.query(ctx, token, coursesQuery, nil, &answer); err != nil {
		return nil, err
	}

	courses := make([]domaincanvas.Course, 0, len(answer.Data.AllCourses))
	for _, raw := range answer.Data.AllCourses {
		course := domaincanvas.Course{
			CanvasID: raw.ID,
			Name:     raw.Name,
			Code:     raw.CourseCode,
		}
		if raw.Term != nil {
			course.Term = raw.Term.Name
			course.TermStart = raw.Term.StartAt
		}
		courses = append(courses, course)
	}
	return courses, nil
}

// rosterQuery reads one page of a course's enrolments.
//
// `first: 100` rather than everything at once because Canvas caps a
// connection's page size; the caller follows `pageInfo` to the end. The
// enrolment's own `_id` is carried so the schema can record which Canvas
// enrolment a row came from.
const rosterQuery = `
query($courseId: ID!, $after: String) {
  course(id: $courseId) {
    enrollmentsConnection(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        _id
        type
        state
        user { _id sortableName email sisId }
      }
    }
  }
}`

// studentEnrollmentType is the only enrolment kind that becomes a student.
// A teacher or a TA on the roster would end up in WP-3's mailing
// (ADR-0069 §Decision 4).
const studentEnrollmentType = "StudentEnrollment"

// maxRosterPages bounds the pagination loop.
//
// A `hasNextPage` that never turns false — a Canvas bug, a proxy rewriting
// the body, a cursor this client mishandles — would otherwise be an
// infinite loop inside a request a professor is waiting on. 100 pages at
// 100 rows is 10,000 enrolments, which is far beyond any course and far
// below anything that hurts. Reaching the cap is an error rather than a
// truncated roster: half a class silently is the failure mode this whole
// function exists to avoid.
const maxRosterPages = 100

// Roster returns the students of one Canvas course, following Relay
// pagination to the end.
func (c *Client) Roster(ctx context.Context, token, canvasCourseID string) ([]domaincanvas.Student, error) {
	type node struct {
		ID    string `json:"_id"`
		Type  string `json:"type"`
		State string `json:"state"`
		User  struct {
			ID           string `json:"_id"`
			SortableName string `json:"sortableName"`
			Email        string `json:"email"`
			SISID        string `json:"sisId"`
		} `json:"user"`
	}

	students := []domaincanvas.Student{}
	var after *string

	for page := 0; ; page++ {
		if page >= maxRosterPages {
			return nil, fmt.Errorf("%w: Canvas kept reporting another page of enrolments after %d pages",
				domaincanvas.ErrUnavailable, maxRosterPages)
		}

		var answer struct {
			Data struct {
				Course *struct {
					EnrollmentsConnection struct {
						PageInfo struct {
							HasNextPage bool   `json:"hasNextPage"`
							EndCursor   string `json:"endCursor"`
						} `json:"pageInfo"`
						Nodes []node `json:"nodes"`
					} `json:"enrollmentsConnection"`
				} `json:"course"`
			} `json:"data"`
		}

		variables := map[string]any{"courseId": canvasCourseID, "after": after}
		if err := c.query(ctx, token, rosterQuery, variables, &answer); err != nil {
			return nil, err
		}
		if answer.Data.Course == nil {
			// Canvas answers 200 with a null course for an id this token
			// cannot see — a course that was deleted, or one belonging to
			// someone else. Distinct from an empty roster, which is a
			// course with no students yet.
			return nil, fmt.Errorf("%w: %s", domaincanvas.ErrCourseNotFound, canvasCourseID)
		}

		conn := answer.Data.Course.EnrollmentsConnection
		for _, n := range conn.Nodes {
			if n.Type != studentEnrollmentType {
				continue
			}
			first, last := domaincanvas.SplitSortableName(n.User.SortableName)
			rut, dv := domaincanvas.SplitSISID(n.User.SISID)
			students = append(students, domaincanvas.Student{
				FirstName:          first,
				LastName:           last,
				Email:              n.User.Email,
				RUT:                rut,
				RUTDV:              dv,
				CanvasUserID:       n.User.ID,
				CanvasEnrollmentID: n.ID,
			})
		}

		if !conn.PageInfo.HasNextPage {
			return students, nil
		}
		if conn.PageInfo.EndCursor == "" {
			// hasNextPage true with no cursor to follow: the next request
			// would repeat this page forever. Refusing beats looping, and
			// beats returning what we have as if it were the whole class.
			return nil, fmt.Errorf("%w: Canvas reported another page of enrolments but sent no cursor",
				domaincanvas.ErrUnavailable)
		}
		cursor := conn.PageInfo.EndCursor
		after = &cursor
	}
}

// query posts one GraphQL request and decodes the answer into out.
//
// It maps statuses the way Verify documents — 401/403 are about the token,
// everything else that is not 2xx says nothing about it — and treats a 200
// carrying GraphQL `errors` as ErrUnavailable. That last one matters for
// the data queries in a way it does not for the probe: a partially
// successful GraphQL answer carries both `data` and `errors`, and importing
// the half that arrived would be a roster missing whoever the error was
// about.
func (c *Client) query(ctx context.Context, token, gql string, variables map[string]any, out any) error {
	status, body, err := c.post(ctx, token, gql, variables)
	switch {
	case err != nil:
		return fmt.Errorf("%w: %v", domaincanvas.ErrUnavailable, err)
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return fmt.Errorf("%w: Canvas answered %d", domaincanvas.ErrTokenRejected, status)
	case status < 200 || status > 299:
		return fmt.Errorf("%w: Canvas answered %d", domaincanvas.ErrUnavailable, status)
	}

	var errs struct {
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &errs); err != nil {
		return fmt.Errorf("%w: Canvas answered %d with a body this client cannot read",
			domaincanvas.ErrUnavailable, status)
	}
	if len(errs.Errors) > 0 {
		return fmt.Errorf("%w: Canvas answered 200 with %d GraphQL error(s), the first being %q",
			domaincanvas.ErrUnavailable, len(errs.Errors), errs.Errors[0].Message)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("%w: Canvas's answer did not have the shape this client expects",
			domaincanvas.ErrUnavailable)
	}
	return nil
}
