package handler

import (
	"strconv"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/view"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
)

// The one job queue's surface on the backoffice (ADR-0079): what every
// subject's banner and its dismiss route share. A file of its own because
// it belongs to neither the controls nor the surveys (#310 review, ARQ-3).

// JobDismissPath is POST target for the "Refrescar" / "Cerrar aviso" button
// on the banner (issue #249). The id lives in the URL segment; the
// handler stamps viewed_at on TERMINAL jobs (done|failed) and redirects
// back to the control. On a non-terminal job it just redirects — see
// DismissJob's doc for why (issue #257).
const JobDismissPath = "/jobs/{id}/dismiss"

func jobDismissURL(id int64) string {
	return "/jobs/" + strconv.FormatInt(id, 10) + "/dismiss"
}

// bannerFromJob is a job's banner, whatever its subject: nil once a
// terminal job has been dismissed; otherwise its state, its short error,
// its notice when done, and how long it has been running. label is the
// Spanish name of the work ("análisis", "generación del PDF"). Detail is
// left to the caller, because only some kinds write Spanish there (the
// controls' publication, #297).
func bannerFromJob(job jobs.Job, label string) *view.JobBanner {
	running := !job.Status.IsTerminal()
	if !running && job.ViewedAt != nil {
		return nil
	}
	banner := &view.JobBanner{
		JobID:      job.ID,
		Kind:       label,
		Running:    running,
		Done:       job.Status == jobs.StatusDone,
		Failed:     job.Status == jobs.StatusFailed,
		Error:      job.Error,
		DismissURL: jobDismissURL(job.ID),
	}
	if banner.Done {
		banner.Notice = job.Notice
	}
	if running {
		start := job.CreatedAt
		if job.StartedAt != nil {
			start = *job.StartedAt
		}
		banner.StartedAgo = humanElapsed(time.Since(start))
	}
	return banner
}

// jobSubjectURL is the page a job's banner lives on: its control's, or —
// since #310 — its survey run's, whose survey the payload names. An
// undecodable run payload falls back to the backoffice root rather than to
// a control URL that does not exist.
func jobSubjectURL(job jobs.Job) string {
	if job.SubjectKind != jobs.SubjectSurveyRun {
		return controlDetailURL(job.SubjectID)
	}
	runID, surveyID, err := survey.DecodeRunJob(job.SubjectID, job.Payload)
	if err != nil {
		return "/"
	}
	return SurveyRunPathFor(surveyID, runID)
}
