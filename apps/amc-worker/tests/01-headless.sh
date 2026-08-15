#!/usr/bin/env bash
# S1 / AC-1 — AMC runs headless from the CLI, never opening the GTK GUI.
#
# The container is run with DISPLAY empty and no X socket mounted, so a code
# path that reaches Gtk cannot survive. That is the assertion — not that we
# chose not to open a window, but that a window is unopenable and the CLI works
# anyway.
#
# Also records the measurements AC-8 asks for: image size, and the architecture
# AMC actually runs under. `auto-multiple-choice` ships for arm64 in Debian
# bookworm, so on Apple Silicon this is native and the emulation the issue
# worried about does not happen.

. "$(dirname "$0")/lib.sh"

echo "S1 — AMC runs headless (image: ${IMAGE})"
require_image

# --- the CLI exists -----------------------------------------------------------

check "auto-multiple-choice is on PATH" \
  amc_run which auto-multiple-choice

version="$(amc_run dpkg-query -W -f='${Version}' auto-multiple-choice 2>&1 || true)"
check_contains "AMC 1.6.0 is installed" "1.6.0" "$version"
note "AMC version" "$version"

# --- the dispatcher falls through to the GUI, and that is a trap --------------

# MEASURED, not assumed: `auto-multiple-choice version` — which looks like the
# obvious way to ask a CLI what it is — is not a CLI subcommand at all. The
# dispatcher hands anything it does not recognise to AMC-gui.pl, which then dies
# on `cannot open display`. So the headless guarantee is NOT a property of the
# binary: it is a property of calling only the subcommands that exist.
#
# This is pinned rather than worked around because the HTTP wrapper (S6) will be
# built on this dispatcher, and a typo in a subcommand name would otherwise
# surface as a Gtk error nobody can explain from a stack trace.
gui_fallthrough="$(amc_run auto-multiple-choice definitely-not-a-subcommand 2>&1 || true)"
check_contains "an unknown subcommand falls through to the GUI (a trap the wrapper must avoid)" \
  "cannot open display" "$gui_fallthrough"

# --- every tool the seven acceptance criteria need is present -----------------

# One check per AC that needs a tool, so a missing one names itself rather than
# surfacing three slices later as a confusing failure.
for tool in \
  prepare:AC-2/generation \
  meptex:AC-2/bubble-layout \
  getimages:AC-4/split-scan-batch \
  analyse:AC-3+5/read-and-report \
  association-auto:AC-6/associate \
  note:scoring \
  export:AC-5/consumable-report \
  annotate:AC-7/annotated-pdf; do
  name="${tool%%:*}"
  why="${tool##*:}"
  check "AMC-${name}.pl present (${why})" \
    amc_run test -f "/usr/libexec/AMC/perl/AMC-${name}.pl"
done

# --- the Perl stack loads and runs with no display ---------------------------

# `prepare` with no arguments is the cheapest call that loads AMC's Perl stack
# for real. It must fail on its ARGUMENTS — proving the stack loaded, dispatched
# and got as far as looking for a source file — rather than on a missing display
# or an unresolvable module.
prepare_out="$(amc_run auto-multiple-choice prepare 2>&1 || true)"
check_contains "prepare reaches AMC-prepare.pl (the Perl stack loaded)" \
  "AMC-prepare.pl" "$prepare_out"
check_contains "prepare fails on its arguments, not on its environment" \
  "Nonexistent source file" "$prepare_out"

for forbidden in "Gtk" "cannot open display" "Can't locate"; do
  case "$prepare_out" in
  *"$forbidden"*) fail "prepare output free of '${forbidden}'" "$prepare_out" ;;
  *) pass "prepare output free of '${forbidden}'" ;;
  esac
done

# --- LaTeX is present and knows AMC's own package -----------------------------

check "pdflatex is on PATH" amc_run which pdflatex

sty="$(amc_run kpsewhich automultiplechoice.sty 2>&1 || true)"
check_contains "LaTeX resolves automultiplechoice.sty" ".sty" "$sty"
note "automultiplechoice.sty" "$sty"

# --- the GUI is present, and that is not the same as being needed -------------

# Measured: `auto-multiple-choice-common` depends on libgtk3-perl, so the GTK
# stack is IN the image and packaging cannot exclude it. The headless claim
# therefore cannot be "no GUI exists" — it is "no display exists, and the CLI
# does not need one", which the runs above prove. Asserting absence here would
# have been a check we could only make pass by lying about the image.
gtk="$(amc_run sh -c 'dpkg -l libgtk3-perl 2>/dev/null | tail -1' 2>&1 || true)"
note "GTK in image" "$(printf '%s' "$gtk" | awk '{ print $2, $3 }')"

xsock="$(amc_run sh -c 'ls /tmp/.X11-unix 2>&1 || true' 2>&1 || true)"
check_contains "no X socket reachable in the container" "No such file" "$xsock"

# --- measurements (AC-8) ------------------------------------------------------

# uname spells the same architecture differently on Darwin (arm64) and Linux
# (aarch64), so compare normalised names — otherwise this reports emulation on a
# machine that is running native.
normalise_arch() {
  case "$1" in
  arm64 | aarch64) echo "arm64" ;;
  x86_64 | amd64) echo "amd64" ;;
  *) echo "$1" ;;
  esac
}

host_arch="$(normalise_arch "$(uname -m)")"
container_arch="$(normalise_arch "$(amc_run uname -m | tr -d '\r\n')")"
check_eq "runs native on the host architecture, not emulated" "$host_arch" "$container_arch"
note "architecture" "host ${host_arch} / container ${container_arch} (native)"

size_bytes="$(docker image inspect "$IMAGE" --format '{{.Size}}')"
note "image size" "$(awk -v b="$size_bytes" 'BEGIN { printf "%.2f GB (%d bytes)", b/1024/1024/1024, b }')"

summary
