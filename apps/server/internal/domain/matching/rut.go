package matching

import "strings"

// rutBodyDigits is the width of `student.rut` and of the printed sheet's
// `\AMCcode{rut}{8}`. Migration 00014 enforces it with a GLOB; this
// package's job is to produce it or to refuse.
const rutBodyDigits = 8

// NormalizeRUT turns a RUT as somebody wrote it into the eight-digit body
// `student.rut` holds, or refuses.
//
// Two callers, two shapes. AMC hands over what it read out of the boxes —
// eight digits, no verifier, zero-padded, because the code field is fixed
// width. A professor correcting that reading types whatever a Chilean
// writes: `11.222.333-5`, `11222333-5`, `112223335`, or just the eight
// digits in front of them.
//
// THE DECISION THIS FUNCTION TURNS ON: eight bare digits are the BODY,
// never a seven-digit body plus its verifier. That is exactly what the
// sheet prints and what the review page's field asks for, so it is the
// overwhelmingly common input, and reading it the other way would take
// every AMC reading and shift it one digit — matching a different person
// or nobody, silently.
//
// canvas.SplitSISID makes the OPPOSITE call, correctly, for the opposite
// input: ADR-0069 measured Canvas's `user.sisId` as always carrying the
// verifier, so there the last character always is one. The two functions
// have the same shape and live two packages apart; using the Canvas one
// here would turn `11222333` into the body `01122233`.
// TestEightDigitsAreTheBodyUnlikeCanvasSISIDs is the pin against a future
// deduplication of the two.
//
// A verifier is dropped only where it is UNAMBIGUOUS: after a `-`, or as
// a trailing K, or as the ninth digit of a nine-digit string (no body is
// nine digits long). What that leaves unhandled is a professor typing a
// seven-digit RUT with its verifier and no separator — `11222335` for
// 1.122.233-5 — which is read as the body `11222335`. It is a real gap,
// and the reason it is left open rather than guessed at is that guessing
// is the failure that costs somebody else's grade: this way the copy
// either matches the person who owns those eight digits or matches
// nobody and goes to reconciliation, and both are states a human can see.
// The review page's field is labelled with what it wants.
//
// Refusal returns ("", false) — never a partial body, and never a
// best-effort guess.
func NormalizeRUT(raw string) (string, bool) {
	cleaned := strings.ToUpper(strings.TrimSpace(raw))

	// Dots and spaces are formatting; a hyphen is structure, so it is
	// kept for the split below and removed there.
	cleaned = strings.Map(func(r rune) rune {
		if r == '.' || r == ' ' {
			return -1
		}
		return r
	}, cleaned)
	if cleaned == "" {
		return "", false
	}

	body := cleaned
	switch hyphens := strings.Count(cleaned, "-"); hyphens {
	case 0:
		// A trailing K is always a verifier: the body is digits only.
		if strings.HasSuffix(cleaned, "K") {
			body = cleaned[:len(cleaned)-1]
			break
		}
		if !isDigits(cleaned) {
			return "", false
		}
		// Nine digits cannot be a body, so the last one is a verifier.
		// Eight or fewer are the body itself — see the note above.
		if len(cleaned) == rutBodyDigits+1 {
			body = cleaned[:rutBodyDigits]
		}
	case 1:
		// Everything before the hyphen is the body, everything after is
		// the verifier. The verifier is discarded, but it still has to
		// LOOK like one: "11222333-99" is not a RUT anybody wrote, and
		// accepting it would mean accepting a body from a string whose
		// shape we do not understand.
		before, after, _ := strings.Cut(cleaned, "-")
		if before == "" || after == "" {
			return "", false
		}
		if after != "K" && !isDigits(after) {
			return "", false
		}
		if len(after) != 1 {
			return "", false
		}
		body = before
	default:
		// "11-222-333" and friends: a shape this function does not
		// understand, refused rather than stripped into something that
		// would match a stranger.
		return "", false
	}

	if !isDigits(body) || len(body) > rutBodyDigits {
		return "", false
	}
	// Left-pad rather than reject: the sheet prints eight boxes whatever
	// the RUT's length, so a seven-digit RUT reaches `reading.rut_read`
	// as `09876543` and the column it must join holds the same.
	return strings.Repeat("0", rutBodyDigits-len(body)) + body, true
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
