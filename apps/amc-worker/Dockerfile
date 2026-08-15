# amc-worker — Auto-Multiple-Choice, driven from the CLI, no GUI.
#
# Why this is its own image and not part of apps/server: AMC drags Perl, LaTeX
# and OpenCV. The Go server is a small static binary, and merging the two would
# put a multi-gigabyte toolchain on the deploy path of every server change.
# See docs/design/2026-08-controles.md (C9).
#
# `auto-multiple-choice` ships for arm64 in Debian bookworm, so this image is
# native on Apple Silicon — no emulation, which is what #138's AC-8 set out to
# measure.

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

# --no-install-recommends keeps out auto-multiple-choice-doc and the editors the
# package suggests. The texlive set is the minimum that compiles an AMC document
# in Spanish: base + recommended for LaTeX itself, extra for what
# automultiplechoice.sty pulls in, lang-spanish for babel, fonts-recommended so
# the compiled PDF is not missing glyphs.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        auto-multiple-choice \
        texlive-latex-base \
        texlive-latex-recommended \
        texlive-latex-extra \
        texlive-fonts-recommended \
        texlive-lang-spanish \
        poppler-utils \
        ghostscript \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# /work is the volume the caller shares with us: projects in, PDFs and reports
# out. Nothing large crosses the HTTP boundary — requests name paths under here.
WORKDIR /work

# No ENTRYPOINT on purpose: for the spike the image is driven by `docker run`
# with an explicit command, and the HTTP wrapper (S6) becomes the entry point
# when it exists. An entry point now would only be something to override.
CMD ["auto-multiple-choice", "version"]
