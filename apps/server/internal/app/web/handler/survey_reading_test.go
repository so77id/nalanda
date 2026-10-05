package handler_test

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey/tex"
)

// Issue #311: a run's scans, read and reviewed. The service runs against
// the real store and the amctest fake worker (testing-strategy.md L6).

// readableRun is a generated run of the three-question bank, and its
// questions: single "¿Ritmo?" (lento, rápido), scale "¿Clara?" (5 points),
// context "¿Sección?" (A, B).
type readableRun struct {
	s                       survey.Survey
	run                     survey.Run
	single, scale, contextQ survey.Question
}

func (f *surveyFixture) readableRun() readableRun {
	f.t.Helper()
	s := f.createSurvey("Banco")
	single, scale, contextQ := f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	f.finishGeneration(s, run)
	return readableRun{s: s, run: run, single: single, scale: scale, contextQ: contextQ}
}

// answer is one ReportAnswer on question q.
func answer(q survey.Question, status survey.AnswerStatus, marked []int, doubtful ...int) survey.ReportAnswer {
	return survey.ReportAnswer{Name: tex.QuestionName(q.ID), Status: status, Marked: marked, Doubtful: doubtful}
}

// analyse runs the survey_analyse job of batch over the run, the way the
// runner would.
func (f *surveyFixture) analyse(r readableRun, batch string) error {
	f.t.Helper()
	return survey.NewAnalyseHandler(f.surveys)(context.Background(),
		strconv.FormatInt(r.run.ID, 10), survey.EncodeAnalysePayload(r.s.ID, batch))
}

func TestAnAnalysedBatchStoresMarksAndItemsAndSaysWhatItRead(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	f.worker.SurveyReports = []survey.Report{{
		Batch: &survey.Batch{Captured: 2, Failed: 1},
		Copies: []survey.ReportCopy{
			{CopyNumber: 1, Pages: []int{1}, Answers: []survey.ReportAnswer{
				answer(r.single, survey.AnswerOK, []int{2}),
				answer(r.scale, survey.AnswerOK, []int{4}),
				answer(r.contextQ, survey.AnswerBlank, nil),
			}},
			{CopyNumber: 2, Pages: []int{2}, Answers: []survey.ReportAnswer{
				answer(r.single, survey.AnswerAmbiguous, []int{1, 2}),
				answer(r.scale, survey.AnswerDoubtful, nil, 3),
				answer(r.contextQ, survey.AnswerOK, []int{1}),
			}},
		},
	}}

	err := f.analyse(r, "batch-1.pdf")
	var notice *jobs.Notice
	if !errors.As(err, &notice) {
		t.Fatalf("the job returned %v, want a done job's notice", err)
	}
	for _, want := range []string{"2 página(s)", "2 copia(s) leída(s)", "1 por revisar", "1 página(s) no se reconocieron"} {
		if !strings.Contains(notice.Message, want) {
			t.Errorf("notice %q lacks %q", notice.Message, want)
		}
	}
	call := f.worker.SurveyAnalyzeCalls[0]
	if !strings.HasSuffix(call.ScanPDF, "/uploads/batch-1.pdf") || !strings.HasSuffix(call.Source, "/inputs/source.tex") ||
		call.Ticked != survey.DefaultTicked || call.Unsure != survey.DefaultUnsure {
		t.Errorf("the worker was asked %+v", call)
	}

	ctx := context.Background()
	counts, err := f.surveys.ReadingCounts(ctx, r.run.ID)
	if err != nil || counts != (survey.ReadingCounts{Copies: 2, PendingCopies: 1, PendingItems: 2}) {
		t.Errorf("counts = %+v, %v", counts, err)
	}
	one, err := f.surveys.CopyReading(ctx, r.run.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(one.Marks) != 2 || one.Marks[0].AlternativeID != r.single.Alternatives[1].ID || one.Marks[1].AlternativeID != r.scale.Alternatives[3].ID {
		t.Errorf("copy 1's marks = %+v", one.Marks)
	}
	two, _ := f.surveys.CopyReading(ctx, r.run.ID, 2)
	if len(two.Marks) != 1 || len(two.Items) != 2 {
		t.Errorf("copy 2 = %d marks, %d items; want the context mark and two items", len(two.Marks), len(two.Items))
	}
}

func TestABatchThatStoresNothingSaysWhy(t *testing.T) {
	cases := map[string]struct {
		report survey.Report
		err    error
		want   string
	}{
		"no page of this run": {
			report: survey.Report{Batch: &survey.Batch{Captured: 0, Failed: 3}},
			want:   "Ninguna página de ese PDF es de esta pasada",
		},
		"a question the run never printed": {
			report: survey.Report{Batch: &survey.Batch{Captured: 1}, Copies: []survey.ReportCopy{{CopyNumber: 1, Answers: []survey.ReportAnswer{
				{Name: "q999", Status: survey.AnswerOK, Marked: []int{1}},
			}}}},
			want: "La lectura no coincide",
		},
		"the worker refusing": {err: survey.ErrAnalyzerRefused, want: "rechazó el lote"},
		"the worker away":     {err: survey.ErrAnalyzerUnavailable, want: "no responde"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			f := newSurveyFixture(t)
			r := f.readableRun()
			f.worker.SurveyReports = []survey.Report{tc.report}
			f.worker.SurveyAnalyzeErr = tc.err

			err := f.analyse(r, "batch-1.pdf")
			var failure *jobs.Failure
			if !errors.As(err, &failure) || !strings.Contains(failure.Message, tc.want) {
				t.Fatalf("the job returned %v, want a failure saying %q", err, tc.want)
			}
			if counts, _ := f.surveys.ReadingCounts(context.Background(), r.run.ID); counts.Copies != 0 {
				t.Errorf("%d copies stored by a batch that failed", counts.Copies)
			}
		})
	}
}

func TestACancelledRunIsNotRead(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	if err := f.surveys.CancelRun(context.Background(), r.s.ID, r.run.ID); err != nil {
		t.Fatal(err)
	}
	var failure *jobs.Failure
	if err := f.analyse(r, "batch-1.pdf"); !errors.As(err, &failure) || !strings.Contains(failure.Message, "ya no está abierta") {
		t.Fatalf("reading a cancelled run: %v", err)
	}
	if len(f.worker.SurveyAnalyzeCalls) != 0 {
		t.Error("the worker was asked to read a cancelled run")
	}
}
