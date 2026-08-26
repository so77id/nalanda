package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/app/web/flash"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// AdminBankRefreshPath is the manual bank-refresh endpoint (issue #230).
// URL in English like every other route on this surface (issue #151
// §Routes); the button label a professor reads stays Spanish.
const AdminBankRefreshPath = "/admin/bank/refresh"

// AdminBank holds the admin bank-refresh handler. Constructed once in
// cmd/server; refuses an incomplete set at wire time so a nil dereference
// inside a request is impossible (backend-code-style.md §Errors).
type AdminBank struct {
	Bank      *bank.LiveBank
	PublicURL string
	Log       *slog.Logger

	secureCookie bool
}

// NewAdminBank returns the handler.
func NewAdminBank(deps AdminBank) *AdminBank {
	switch {
	case deps.Bank == nil:
		panic("handler.NewAdminBank: no bank")
	case deps.PublicURL == "":
		panic("handler.NewAdminBank: no public URL — the flash cookie's Secure attribute is derived from it")
	case deps.Log == nil:
		panic("handler.NewAdminBank: no logger")
	}
	deps.secureCookie = config.SecureFor(deps.PublicURL)
	return &deps
}

// Refresh handles POST /admin/bank/refresh. It calls LiveBank.Reload,
// writes a Spanish flash naming the outcome, and redirects the professor
// back where they came from — /controls if the Referer is missing or
// off-origin.
//
// The redirect target is Referer-derived rather than a fixed constant
// because the button appears in the top bar on every backoffice page,
// and losing the professor's context (which control they were looking at)
// on every refresh is a small paper cut with no upside. The
// same-origin guard below is why an evil Referer can never become an
// open redirect: PublicURL is the deployed origin (host + optional port,
// no path — see config.Load's validation), and only a Referer whose
// origin matches it survives.
func (h *AdminBank) Refresh(w http.ResponseWriter, r *http.Request) {
	updated, err := h.Bank.Reload(r.Context())
	switch {
	case err != nil:
		h.Log.Warn("manual bank refresh failed", "url", h.Bank.URL(), "error", err)
		flash.Set(w, h.secureCookie, "No se pudo recargar el banco: "+err.Error())
	case !updated:
		flash.Set(w, h.secureCookie, "El banco ya estaba al día.")
	default:
		b := h.Bank.Get()
		flash.Set(w, h.secureCookie, fmt.Sprintf("Banco recargado: %d documentos, %d preguntas.",
			len(b.Documents), len(b.Questions)))
	}
	http.Redirect(w, r, safeRedirect(r.Header.Get("Referer"), h.PublicURL), http.StatusSeeOther)
}

// safeRedirect returns a URL the handler will bounce to after a refresh.
// A referer that shares scheme+host with PublicURL keeps its path (so the
// professor lands back on the page they clicked from). Anything else —
// empty, malformed, or off-origin — falls back to /controls.
//
// The scheme+host guard alone is not enough. A same-origin referer whose
// path begins with `//` (e.g. `https://nalanda.test//evil.com/x` — the
// path is `//evil.com/x`, the host is nalanda.test) passes the origin
// check, and Go's http.Redirect writes the Location header verbatim; a
// browser then resolves `//evil.com/x` as a scheme-relative URL and
// navigates to `https://evil.com/x`. IMPORTANT-1 from the WP review
// reproduced that on the real function. The extra check below rejects
// any path that does not start with a single `/` followed by a non-`/`
// non-`\` character — the two forms browsers historically resolve as
// scheme-relative navigations.
func safeRedirect(referer, publicURL string) string {
	if referer == "" {
		return ControlsPath
	}
	refParsed, err := url.Parse(referer)
	if err != nil || refParsed.Path == "" {
		return ControlsPath
	}
	pubParsed, err := url.Parse(publicURL)
	if err != nil {
		return ControlsPath
	}
	if !strings.EqualFold(refParsed.Scheme, pubParsed.Scheme) || refParsed.Host != pubParsed.Host {
		return ControlsPath
	}
	if !strings.HasPrefix(refParsed.Path, "/") ||
		strings.HasPrefix(refParsed.Path, "//") ||
		strings.HasPrefix(refParsed.Path, `/\`) {
		return ControlsPath
	}
	target := refParsed.Path
	if refParsed.RawQuery != "" {
		target += "?" + refParsed.RawQuery
	}
	return target
}
