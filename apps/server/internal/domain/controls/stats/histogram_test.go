package stats_test

import (
	"reflect"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls/stats"
)

// The histogram and boxplot are the two shape summaries the panel
// renders in-line. They read the SAME grades the Global metrics read
// through NumericGrade — a graded control's histogram cannot show a
// column the readings table does not put in the sum.

func TestHistogramBinsGradesByDecimals(t *testing.T) {
	// Grades: 2.5, 4.0, 4.0, 5.5, 7.0. Bins are one per decimal
	// starting at 1.0 through 7.0 inclusive → 61 bins.
	four := []controls.Reading{
		reading(1, []controls.Answer{ // 1/4 → 2.5
			simpleOK("q1", 1), simpleOK("q2", 0), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(2, []controls.Answer{ // 2/4 → 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(3, []controls.Answer{ // 2/4 → 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(4, []controls.Answer{ // 3/4 → 5.5
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 0),
		}),
		reading(5, []controls.Answer{ // 4/4 → 7.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 1),
		}),
	}
	s := stats.Compute(four, nil, 4)
	if got, want := len(s.Histogram.Bins), 61; got != want {
		t.Fatalf("len(Bins) = %d, want %d (1.0..7.0 inclusive by 0.1)", got, want)
	}
	// First bin is 1.0, last is 7.0.
	if !closeEnough(s.Histogram.Bins[0].Grade, 1.0) {
		t.Errorf("Bins[0].Grade = %v, want 1.0", s.Histogram.Bins[0].Grade)
	}
	if !closeEnough(s.Histogram.Bins[60].Grade, 7.0) {
		t.Errorf("Bins[60].Grade = %v, want 7.0", s.Histogram.Bins[60].Grade)
	}
	// Bin at 2.5 counts one, 4.0 counts two, 5.5 one, 7.0 one, rest zero.
	if s.Histogram.Bins[15].Count != 1 { // 1.0 + 0.1*15 = 2.5
		t.Errorf("Bins[15] (2.5) count = %d, want 1", s.Histogram.Bins[15].Count)
	}
	if s.Histogram.Bins[30].Count != 2 { // 4.0
		t.Errorf("Bins[30] (4.0) count = %d, want 2", s.Histogram.Bins[30].Count)
	}
	if s.Histogram.Bins[45].Count != 1 { // 5.5
		t.Errorf("Bins[45] (5.5) count = %d, want 1", s.Histogram.Bins[45].Count)
	}
	if s.Histogram.Bins[60].Count != 1 { // 7.0
		t.Errorf("Bins[60] (7.0) count = %d, want 1", s.Histogram.Bins[60].Count)
	}
	// Everything else zero.
	for i, b := range s.Histogram.Bins {
		if i == 15 || i == 30 || i == 45 || i == 60 {
			continue
		}
		if b.Count != 0 {
			t.Errorf("Bins[%d] (%.1f) count = %d, want 0", i, b.Grade, b.Count)
		}
	}
	if s.Histogram.MaxCount != 2 {
		t.Errorf("Histogram.MaxCount = %d, want 2", s.Histogram.MaxCount)
	}
}

func TestHistogramEmptyWhenNoValidGrades(t *testing.T) {
	// All excluded → the histogram is empty (nil Bins, MaxCount 0).
	// A panel that renders this decides how to caption it; the math
	// just says "no data".
	readings := []controls.Reading{
		{CopyNumber: 1, CopyStatus: controls.CopyStatusNotPresent, RUTStatus: controls.RUTStatusNotPresent},
	}
	s := stats.Compute(readings, nil, 4)
	if s.Histogram.Bins != nil {
		t.Errorf("Histogram.Bins = %v, want nil", s.Histogram.Bins)
	}
	if s.Histogram.MaxCount != 0 {
		t.Errorf("Histogram.MaxCount = %d, want 0", s.Histogram.MaxCount)
	}
}

func TestBoxplotOnFourGrades(t *testing.T) {
	// 2.5, 4.0, 5.5, 7.0 → Q1 = median of lower half {2.5, 4.0} = 3.25;
	// median = (4.0 + 5.5)/2 = 4.75; Q3 = median of upper half {5.5,
	// 7.0} = 6.25. IQR = 3.0. Whiskers = min/max within 1.5*IQR of the
	// hinges; no value is an outlier here.
	four := []controls.Reading{
		reading(1, []controls.Answer{ // 2.5
			simpleOK("q1", 1), simpleOK("q2", 0), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(2, []controls.Answer{ // 4.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
		reading(3, []controls.Answer{ // 5.5
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 0),
		}),
		reading(4, []controls.Answer{ // 7.0
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 1),
		}),
	}
	s := stats.Compute(four, nil, 4)
	if !closeEnough(s.Boxplot.Q1, 3.25) {
		t.Errorf("Boxplot.Q1 = %v, want 3.25", s.Boxplot.Q1)
	}
	if !closeEnough(s.Boxplot.Median, 4.75) {
		t.Errorf("Boxplot.Median = %v, want 4.75", s.Boxplot.Median)
	}
	if !closeEnough(s.Boxplot.Q3, 6.25) {
		t.Errorf("Boxplot.Q3 = %v, want 6.25", s.Boxplot.Q3)
	}
	if !closeEnough(s.Boxplot.WhiskerLow, 2.5) {
		t.Errorf("Boxplot.WhiskerLow = %v, want 2.5", s.Boxplot.WhiskerLow)
	}
	if !closeEnough(s.Boxplot.WhiskerHigh, 7.0) {
		t.Errorf("Boxplot.WhiskerHigh = %v, want 7.0", s.Boxplot.WhiskerHigh)
	}
	if len(s.Boxplot.Outliers) != 0 {
		t.Errorf("Boxplot.Outliers = %v, want []", s.Boxplot.Outliers)
	}
}

func TestBoxplotOutlierBelowLowFence(t *testing.T) {
	// Grades: 1.0, 4.0, 4.0, 4.0, 4.0. Sorted median = 4.0. Lower half
	// {1.0, 4.0} → Q1=2.5; upper half {4.0, 4.0} → Q3=4.0. IQR=1.5.
	// Low fence = Q1 - 1.5*IQR = 0.25 → 1.0 is above the fence, so
	// nothing is an outlier. Add one 1.0 below fence: use grades 1.0
	// but Q1's minimum = 1.0. Use a stronger scenario: grades
	// [1.0, 5.5, 5.5, 5.5, 5.5]. Median = 5.5, lower={1.0,5.5}
	// Q1=3.25, upper={5.5,5.5} Q3=5.5, IQR=2.25. Low fence =
	// 3.25 - 1.5*2.25 = -0.125. 1.0 is above → still no outlier.
	//
	// Boxplot outliers are rare on the 1–7 scale because the range is
	// so tight. Force one with a spread: [1.0, 5.5, 5.5, 5.5, 5.5,
	// 5.5, 5.5, 5.5, 5.5]. Median = 5.5. Lower half of the eight
	// values around it: {1.0, 5.5, 5.5, 5.5} → Q1 = (5.5+5.5)/2 = 5.5.
	// Upper {5.5,5.5,5.5,5.5} → Q3 = 5.5. IQR=0. Low fence = 5.5 → 1.0
	// IS an outlier (below fence).
	nine := []controls.Reading{
		reading(1, []controls.Answer{ // 0/4 → 1.0
			simpleOK("q1", 0), simpleOK("q2", 0), simpleOK("q3", 0), simpleOK("q4", 0),
		}),
	}
	for i := 2; i <= 9; i++ {
		nine = append(nine, reading(i, []controls.Answer{ // 3/4 → 5.5
			simpleOK("q1", 1), simpleOK("q2", 1), simpleOK("q3", 1), simpleOK("q4", 0),
		}))
	}
	s := stats.Compute(nine, nil, 4)
	got := s.Boxplot.Outliers
	want := []float64{1.0}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Boxplot.Outliers = %v, want %v", got, want)
	}
	if !closeEnough(s.Boxplot.WhiskerLow, 5.5) {
		t.Errorf("Boxplot.WhiskerLow = %v, want 5.5 (outlier is not the whisker)", s.Boxplot.WhiskerLow)
	}
}

func TestBoxplotEmptyWhenNoValidGrades(t *testing.T) {
	readings := []controls.Reading{
		{CopyNumber: 1, CopyStatus: controls.CopyStatusNotPresent, RUTStatus: controls.RUTStatusNotPresent},
	}
	s := stats.Compute(readings, nil, 4)
	empty := stats.Boxplot{}
	if !reflect.DeepEqual(s.Boxplot, empty) {
		t.Errorf("Boxplot = %+v, want empty %+v", s.Boxplot, empty)
	}
}
