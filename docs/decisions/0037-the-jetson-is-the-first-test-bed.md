# ADR-0037: The Jetson is the first test bed, chosen because it exists

**Status:** Accepted — off-box execution outstanding (Miguel runs the AWS
provisioning, the Funnel bring-up, and `GOOGLE-CHECK.md` on https)
**Date:** 2026-08-17
**Decision-makers:** Miguel Rodriguez
**Source:** #162, design `docs/design/2026-08-controles.md` §C15, ADR-0034
§Consequences, WP-C2 (#150) — the five review triggers that fire at the first
deploy.

## Context

§C15 deferred hosting deliberately: the choice of where `apps/server` would
run was to be made *"when there is something to deploy"*. WP-C2 (#150) made
something to deploy — a professor signs in with Google — and in doing so left
five review triggers, each of them stated as *"the first deploy of
`apps/server`"*:

- `security-notes.md` §"The professor login is public, unrate-limited and
  remembered in memory" — the trigger to build a per-IP throttle.
- §"The login's state cookie is a double-submit cookie" — the trigger to
  adopt the `__Host-` prefix.
- §"The session cookie has no `Secure` flag in development" — the trigger to
  observe the flag on the wire.
- §"The session's IP is `RemoteAddr`, with no proxy-trust story" — the
  trigger to teach `handler.clientIP` which hop to trust.
- ADR-0034 §Consequences: *"one instance may run at a time"* and *"personal
  data at rest without encryption"* — both revisited whenever the deploy
  changes shape.

None of the five can be closed on a laptop. They need a real https origin, a
real Google round trip and a machine that stays up.

Meanwhile DocumentBuddy already owns a Jetson Nano and a Tailscale-issued
`*.ts.net` name (its ADR-010, ADR-014), both currently used to serve one
service on port 443. Tailscale Funnel accepts three ports (443, 8443, 10000),
and 8443 was free. That gives Nalanda its own origin on an existing box at no
cost, with a real TLS certificate, no port forwarding, and no DNS to buy.

## Decision

**`apps/server` runs on DocumentBuddy's Jetson at
`https://<host>.<tailnet>.ts.net:8443`.** The choice is by convenience, not
by architecture — the box exists, has a public https origin, and its earlier
occupant has held up in production for a year. This decision is a **test
bed**, not a home: it exists to produce the measurements the permanent choice
of §C15 will need.

**Only `apps/server` is deployed here.** `apps/amc-worker` is a 1.04 GB image
(LaTeX, OpenCV, ghostscript, poppler), and whether a 4 GB Nano can host it is
a real question that belongs to a WP other than this one. The consequence is
that the professor can log in and reach the backoffice screens WP-C3 built;
`/api/controls/*` returns an amc-worker connection error until the Nano
question is answered.

**Deploy is by hand: `git pull` and `docker compose --profile jetson up -d
--build server backup monitor` on the box.** No CI/CD, no registry, no
automated deploy — §C15 says these decisions are not due, and building them
against a test bed is how they get built for the wrong host. The image is a
12.2 MB static Go binary and the machine is arm64 like the build host, so
nothing cross-compiles; building on a Nano is slow, and it is the only option
that leaves no artefact travelling by hand.

**`restart: unless-stopped` on every compose service.** The Jetson accepts
home power cuts as an acceptable risk (its ADR-010), so a container that
stayed stopped after each of those is silently down until someone notices.
`unless-stopped` — not `always` — respects `docker compose stop` for
maintenance.

**Backup is a second container on the same box.** The `backup` compose service
(`infra/deploy/jetson/backup.sh` + `Dockerfile.backup`) runs `sqlite3 .backup`
against the mounted volume daily at 03:00 UTC, gzips, uploads to
`s3://<nalanda-bucket>/backups/nalanda-<ts>.db.gz`, and posts a `🧭 Nalanda`
line to a dedicated Telegram bot. The bucket has a 30-day lifecycle policy
on `backups/`; the credentials do not carry `s3:DeleteObject`, so a defect in
the container cannot lose historical backups. Shape from DocumentBuddy's
`scripts/backup.sh`, rewired to Nalanda's bucket and bot; a **fresh file, not
a reference**, so an edit here cannot silently touch DocumentBuddy.

**Health monitor is a third container.** `monitor` polls `/health` on the
compose network every 5 minutes, alerts after 3 consecutive failures with a
30-minute cooldown, and posts a recovery line when the server answers again.
Polls the compose network name, NOT the Funnel URL: the point is to
distinguish "server is down" from "Funnel is down". Shape from DocumentBuddy's
`scripts/monitor.sh`; a fresh file, not a reference.

**The port is 8443, not 443, and not a path prefix on 443.** DocumentBuddy
owns 443 on this host; Nalanda gets its own origin instead of a shared one.
A path prefix on 443 was rejected because `config.Load` refuses a base URL
carrying a path — the routes are mounted at the origin root, and accommodating
a prefix means revisiting every route and the cookie's `Path=/`. That is
server work masquerading as a deploy.

**One OAuth client, two redirect URIs.** The existing Google OAuth client
gains a second URI, `https://<host>.<tailnet>.ts.net:8443/login/google/callback`;
the local `http://127.0.0.1:8081/...` one stays so development keeps working.
A second OAuth client was considered and rejected — it doubles the secrets
Miguel manages for no benefit.

**Five review triggers closed or re-deferred with reasons**, all recorded on
their own `security-notes.md` entries:

- **The `__Host-` prefix is adopted in production**, dev keeps the plain
  cookie names. Both directions pinned by literal-string tests
  (`TestSessionCookieNameCarriesHostPrefixInProductionAndNotInDev` and its
  state-cookie twin), and every read/write goes through
  `SessionCookieName(secure)` / `StateCookieName(secure)` rather than a bare
  literal. Closes the state-cookie tossing entry and closes the Secure-flag
  entry.
- **`NALANDA_TRUST_PROXY_HEADERS` teaches `handler.clientIP` which hop to
  trust.** On the Jetson it is `true` — Tailscale Funnel terminates on
  loopback, so `RemoteAddr` is 127.0.0.1 for every visitor. Off by default
  everywhere else, because getting this wrong writes an attacker's chosen
  string into the sessions table. Closes the proxy-trust entry.
- **Rate limiting is re-deferred**, not built. Miguel accepts the risk on
  friends-and-family scale, with a Tailscale-issued URL that is not
  discoverable, and Google's own throttling on the OAuth endpoint as the
  practical ceiling on what a flood at this server can do. New trigger: the
  first non-Miguel professor arriving on a URL whose address gets written
  down anywhere.
- **`GOOGLE-CHECK.md` §7 is the run that observes `Secure` on the wire** —
  Miguel runs it against the https URL after the deploy is up.

## Consequences

### Positive

- **Real https, real cookies, real proxy.** Every WP-C2 review trigger that
  fires at the first deploy fires here, and each one closes or re-defers with
  its reason written down.
- **Zero incremental cost.** The Jetson, the Tailscale account and Miguel's
  AWS bill are the same as before this WP; the AWS pieces added
  (`nalanda-jetson` IAM user, one bucket, 30-day lifecycle) are pennies at
  this size.
- **Recoverable from a wiped box.** A `git clone`, an `.env` from a password
  manager, a `docker compose --profile jetson up -d --build`, and a
  `tailscale funnel --https=8443 on` bring the service back on any Jetson.

### Negative

- **A single point of failure.** One instance, one box, one home power circuit.
  ADR-0034 §Consequences already accepted this and this WP does not fix it —
  a second instance needs Postgres (ADR-0007), which is a decision not due.
- **A shared box with DocumentBuddy.** A resource fight on the Nano affects
  both services. Measured before deploying: the server's static binary is
  12.2 MB and its idle memory is negligible next to DocumentBuddy's Python
  process. If the Nano runs out under real load, this is the entry that gets
  reopened first.
- **Tailscale is now a dependency for reaching Nalanda.** A Tailscale outage
  takes both services down. Free-tier Tailscale has held up for a year on the
  same box, which is the evidence this decision leans on.
- **Deploy is manual.** `git pull` and `docker compose up -d --build` on the
  box. A pipeline is a decision §C15 says is not due, and it would be built
  against the wrong host if built now.

### The permanent home is still open

This ADR does not close §C15. It records the shape and the reasons behind the
test bed, so the permanent decision (stay on the Jetson, move to a VPS, move
to a managed service) can be made against measurements rather than
predictions. **Numbers to collect and report on the issue that decides
§C15**:

- **Image size at build time on arm64** — measured baseline for the server
  today is 12.2 MB on darwin/arm64; the Nano build may drift.
- **Running-container footprint under load** — RSS at boot and after an hour
  of health polls, and at the tail of a login round trip.
- **Cost of a full month** — the AWS side (bucket + transfers), Tailscale
  (free tier headroom), any electrical delta the extra containers cause.
- **How the shared box behaves** — DocumentBuddy's own p95 before and after
  this WP lands, for a week.

### Review triggers for this ADR itself

- **`apps/amc-worker` needs a home too.** The moment WP-E's decision is that
  it runs on the Jetson, this ADR reopens — the 4 GB / 1.04 GB question is
  the reason it is out of scope here, and once it is in scope, the
  single-box / shared-fate story of the "Negative" list above needs
  revisiting.
- **A second physical instance appears.** ADR-0007's Postgres exit becomes
  relevant, and this ADR's "one instance" assumption stops holding.
- **A permanent hosting decision.** §C15 closes, this ADR is superseded, and
  its measurements should be part of what supersedes it.
- **A CI/CD pipeline.** The `git pull` cadence stops being appropriate, and
  the image needs to travel with a registry rather than being built on the
  target.
- **The five WP-C2 triggers this ADR closes.** Any change that would
  reintroduce them — a switch to a proxy that does not own `X-Forwarded-For`,
  a bypass of `SessionCookieName`/`StateCookieName` — reopens the entries
  themselves rather than this ADR.

## Alternatives considered

- **A VPS (Hetzner, DigitalOcean, etc.).** €5/month, a static IP, no shared
  box. Rejected as the first choice because it costs money and time before it
  produces any measurement, and §C15 says the choice needs measurements. It
  is where this ADR points when it is superseded.
- **A path prefix on port 443 of DocumentBuddy's Funnel.** Would share the
  origin with DocumentBuddy and buy no port. Rejected because `config.Load`
  refuses a base URL carrying a path and lifting that restriction is server
  work, not a deploy.
- **A second Tailscale device just for Nalanda.** Would give Nalanda its own
  `*.ts.net` name and port 443. Rejected because Tailscale's free tier caps
  devices; adopting the port that already exists on this device is free.
- **A managed platform (Fly.io, Railway, Render).** Would remove operations
  entirely. Rejected as the first choice because the free tiers do not include
  a persistent SQLite disk (ADR-0007), and adding managed Postgres now
  commits to the ADR-0007 exit before it is needed.

## References

- Design: `docs/design/2026-08-controles.md` §C15 (revised 2026-08-17).
- Deploy procedure: `infra/local/DEPLOY-JETSON.md`.
- Source material on the box: DocumentBuddy's `docs/decisions/010-jetson-nano-hosting.md`
  and `014-tailscale-funnel-public-https.md`.
- Predecessor ADRs on this app: ADR-0034 (`apps/server` layered layout),
  ADR-0006 (Go), ADR-0007 (SQLite first), ADR-0009 (professor-only auth),
  ADR-0036 (the professor session).
- Related security notes: `docs/security-notes.md` §"The professor login is
  public, unrate-limited", §"The login's state cookie is a double-submit
  cookie", §"The session cookie has no Secure flag in development", §"The
  session's IP is RemoteAddr".
