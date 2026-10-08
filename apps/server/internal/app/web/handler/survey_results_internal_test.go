package handler

import "testing"

// #312 review, COR-1/COR-6: Δ reads "= 0" whenever it PRINTS as zero, at
// the precision the row shows.
func TestCompareDeltaIsEqualWhenItPrintsAsZero(t *testing.T) {
	for _, tc := range []struct {
		d         float64
		isPercent bool
		want      string
	}{
		{0.4, true, "= 0"}, {0.5, true, "= 0"}, {-0.5, true, "= 0"}, {0.6, true, "↑ +1 pp"}, {-12, true, "↓ −12 pp"},
		{0.004, false, "= 0"}, {0.006, false, "↑ +0.01"}, {-0.6, false, "↓ −0.60"},
	} {
		if got := compareDelta(tc.d, tc.isPercent); got != tc.want {
			t.Errorf("compareDelta(%v, %v) = %q, want %q", tc.d, tc.isPercent, got, tc.want)
		}
	}
}
