package controls

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
)

// ErrNoScans: the control has nothing a reset could destroy — no batch on
// disk and no reading (issue #298). Kept apart from ErrControlNotFound so a
// caller can tell "there is nothing to wipe" from "there is no control".
var ErrNoScans = errors.New("controls: the control has no scans")

// ScanSummary is what "Borrar escaneos" puts in front of the professor
// before they type the control's name: what the reset will destroy.
type ScanSummary struct {
	// Uploads is how many batch PDFs are on disk.
	Uploads int
	// Readings is how many reading rows exist, not_present ones included —
	// a row the reset would delete is a row it has to count.
	Readings int
	// Read is how many copies carry a reading (not_present ones excluded:
	// nothing was read off them).
	Read int
	// Published is how many copies were already mailed to their student.
	// The reset takes that record with it (ADR-0073), which is why the
	// confirmation page names the number.
	Published int
	// Corrected is how many copies carry a correction made by hand.
	Corrected int
}

// HasScans reports whether a reset would destroy anything. A batch whose
// analyse failed leaves an upload and no reading, and still counts:
// starting over is exactly what that control needs.
func (s ScanSummary) HasScans() bool {
	return s.Uploads > 0 || s.Readings > 0
}

// ScanSummaryFor counts what a reset of the control would destroy.
func (s *Service) ScanSummaryFor(ctx context.Context, controlID string) (ScanSummary, error) {
	uploads, err := s.UploadList(controlID)
	if err != nil {
		return ScanSummary{}, err
	}
	readings, err := s.Readings.ReadingsByControl(ctx, controlID)
	if err != nil {
		return ScanSummary{}, fmt.Errorf("controls.ScanSummaryFor %s: %w", controlID, err)
	}
	summary := ScanSummary{Uploads: len(uploads), Readings: len(readings)}
	for _, r := range readings {
		if r.CopyStatus != CopyStatusNotPresent {
			summary.Read++
		}
		if r.PublishedAt != nil {
			summary.Published++
		}
		if r.LastEditedAt != nil {
			summary.Corrected++
		}
	}
	return summary, nil
}

// ResetScans wipes a control's scans and starts over (issue #298 §E): the
// control ends exactly as it was after generation — printable, unread, next
// upload numbered batch-1.pdf.
//
// THE WORKER GOES FIRST. It owns every write inside the shared volume
// (apps/amc-worker/CLAUDE.md), so it removes AMC's capture, the scan images,
// every page list and the uploaded PDFs; the layout and the printed inputs
// stay, because the paper students wrote on was printed from them. If the
// worker is unreachable, or predates /scans/reset and answers 404, nothing
// has been destroyed yet and the professor sees an error. Only then does
// the database follow, in one transaction (ReadingStore.ResetScanResults).
//
// The reverse order would leave a control whose readings are gone while
// AMC still holds the capture — the next upload would re-analyse over it
// and bring every old correction's absence back as a clean re-read.
func (s *Service) ResetScans(ctx context.Context, controlID string) error {
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return err
	}
	// Before the worker, like Purge's own gate: the SQL guard in
	// ResetScanResults also refuses an archived control, but only after
	// the worker has already emptied its capture (#298 review, ARQ-1).
	if control.DeletedAt != nil {
		return fmt.Errorf("controls.ResetScans %s: archived: %w", controlID, ErrControlNotFound)
	}
	summary, err := s.ScanSummaryFor(ctx, controlID)
	if err != nil {
		return err
	}
	if !summary.HasScans() {
		return fmt.Errorf("controls.ResetScans %s: %w", controlID, ErrNoScans)
	}
	project := filepath.ToSlash(filepath.Join(projectPrefix, control.ID))
	if err := s.Analyzer.ResetScans(ctx, project); err != nil {
		return err
	}
	if err := s.Readings.ResetScanResults(ctx, control.ID); err != nil {
		return fmt.Errorf("controls.ResetScans %s: %w", controlID, err)
	}
	return nil
}
