# apps/server — the Nalanda backend, as a static binary on an empty base image.
#
# Why this is its own image and not part of apps/amc-worker: that one drags
# Perl, LaTeX and OpenCV and weighs about a gigabyte. This is a Go binary of a
# few megabytes, and merging the two would put a multi-gigabyte toolchain on the
# deploy path of every server change. See docs/design/2026-08-controles.md (C9).
#
# The whole reason `scratch` is reachable here is modernc.org/sqlite: a pure-Go
# SQLite with no CGO, so the binary needs no libc, no dynamic loader and no
# base distribution at all (ADR-0007, ADR-0034).

# --- build -------------------------------------------------------------------
# Pinned by digest, not only by tag: a tag is a moving pointer, and "the build
# that worked last week" has to be reproducible for a project measured in years.
FROM golang:1.25-alpine@sha256:3eb6c2b3db8d55e38537302edb510b4417f8a115efbd5906d131ceba9468e29a AS build

WORKDIR /src

# Dependencies first, as their own layer: go.mod and go.sum change far less
# often than the source, so an edit to a handler does not re-download the
# module graph.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# The directory the database lives in, created here because scratch has no
# shell to mkdir with and no chown to fix ownership afterwards. Docker seeds a
# named volume from whatever is at the mount point in the image, permissions
# included, so this is what makes the volume writable by the unprivileged UID
# below.
RUN mkdir -p /data && chown 65532:65532 /data

# CGO_ENABLED=0 is the load-bearing flag. With it on, the toolchain would link
# against Alpine's musl and the binary would not run on `scratch` — and the
# failure appears at container start, not at build time.
#
# -trimpath keeps the builder's absolute paths out of the binary; the ldflags
# drop the symbol table and DWARF, which is a few megabytes of nothing anyone
# debugs in production.
RUN CGO_ENABLED=0 GOOS=linux go build \
        -trimpath \
        -ldflags='-s -w' \
        -o /server \
        ./cmd/server

# --- run ---------------------------------------------------------------------
FROM scratch

# Certificate authorities, for the OAuth calls WP-C2 will make. Nothing in this
# WP talks to the network, but a scratch image has no CA bundle at all and the
# failure it produces ("x509: certificate signed by unknown authority") sends
# whoever meets it looking in entirely the wrong place.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Timestamps are UTC. Without zoneinfo, time.LoadLocation fails on scratch; the
# server has no reason to want a local zone, and a control's dates are the
# professor's problem in a browser, not the server's.
ENV TZ=UTC

COPY --from=build --chown=65532:65532 /data /data
COPY --from=build /server /server

# An unprivileged, numeric UID. Numeric because scratch has no /etc/passwd for a
# name to resolve against, and the volume holding the database must be writable
# by this UID — see infra/local/docker-compose.yml.
USER 65532:65532

# Documentation only; publishing is the compose file's job. The container binds
# every interface because its own network namespace is the boundary.
EXPOSE 8081

ENTRYPOINT ["/server"]
