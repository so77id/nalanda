package files_test

import (
	"errors"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
)

func TestValidRelAcceptsACleanRelativePath(t *testing.T) {
	for _, rel := range []string{
		"controls/ABC/out/sujet.pdf",
		"controls/ABC/uploads",
		"surveys/1/runs/2/scans/copy-3-page-1.jpg",
		"pool.json",
	} {
		if err := files.ValidRel(rel); err != nil {
			t.Errorf("ValidRel(%q) = %v, want nil", rel, err)
		}
	}
}

// Each case breaks a clean path in exactly one way. A path that reaches the
// disk or a bucket key unvalidated is how a request names a file outside the
// project it was asked about.
func TestValidRelRefusesEveryPathThatIsNotCleanAndRelative(t *testing.T) {
	for _, tc := range []struct {
		name, rel string
	}{
		{"empty", ""},
		{"absolute", "/controls/ABC/out/sujet.pdf"},
		{"parent segment", "controls/../ABC/out/sujet.pdf"},
		{"leading parent", "../work/controls/ABC/pool.json"},
		{"only a parent", ".."},
		{"only a dot", "."},
		{"dot segment", "controls/./ABC/pool.json"},
		{"empty segment", "controls//ABC/pool.json"},
		{"trailing slash", "controls/ABC/uploads/"},
		{"backslash", `controls\ABC\pool.json`},
		{"reserved directory", "controls/ABC/.nalanda/links.json"},
		{"reserved directory itself", "controls/ABC/.nalanda"},
		{"NUL byte", "controls/ABC/pool.json\x00"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := files.ValidRel(tc.rel)
			if !errors.Is(err, files.ErrInvalidPath) {
				t.Errorf("ValidRel(%q) = %v, want ErrInvalidPath", tc.rel, err)
			}
		})
	}
}
