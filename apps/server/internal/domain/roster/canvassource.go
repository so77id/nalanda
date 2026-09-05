package roster

import (
	"context"

	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
)

// CanvasSource adapts canvas.Service to this domain's CourseSource port.
//
// It is a translation and nothing else: it exists so `roster` depends on a
// port it declares rather than on the canvas package's own types, which is
// what lets the picker's cases run with no Canvas at all and what would let
// a second source — a CSV, a different LMS — cost an adapter instead of a
// change to Service.
//
// It lives here, in the CONSUMING domain, rather than in `canvas`: the
// dependency has to point inwards, and a canvas package importing roster to
// satisfy roster's interface would point it the other way.
type CanvasSource struct {
	Canvas *canvas.Service
}

// NewCanvasSource returns the adapter.
func NewCanvasSource(c *canvas.Service) *CanvasSource {
	if c == nil {
		panic("roster.NewCanvasSource: no Canvas service")
	}
	return &CanvasSource{Canvas: c}
}

var _ CourseSource = (*CanvasSource)(nil)

// CoursesFor translates canvas.Course into SourceCourse. The error is
// passed through untouched, sentinel and all: the screen renders a
// different thing for each of ErrNotConfigured, ErrNoToken,
// ErrTokenRejected and ErrUnavailable, and wrapping them here would put a
// second opinion between the domain that raised them and the handler that
// reads them.
func (s *CanvasSource) CoursesFor(ctx context.Context, userID int64) ([]SourceCourse, error) {
	fromCanvas, err := s.Canvas.CoursesFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	courses := make([]SourceCourse, 0, len(fromCanvas))
	for _, c := range fromCanvas {
		courses = append(courses, SourceCourse{
			CanvasID:  c.CanvasID,
			Name:      c.Name,
			Code:      c.Code,
			Term:      c.Term,
			TermStart: c.TermStart,
		})
	}
	return courses, nil
}
