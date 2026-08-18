# ADR-0038: The Jetson is the first test bed, chosen because it exists

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

**Both `apps/server` AND `apps/amc-worker` are deployed here** (this decision
opened as "`apps/server` only" in #162 and closed by #175 with the
measurement). `apps/amc-worker` is a 1.04 GB image (LaTeX, OpenCV, ghostscript,
poppler), and whether a 4 GB Nano can host it alongside DocumentBuddy was the
open question this decision named as the trigger for opening it. Result of the
measurement (recorded post-first-generation):

- **Idle RSS of `nalanda-amc-worker`**: TODO — filled after the first bring-up
  on the box. Expected: <200 MB for the AMC engine at rest.
- **Peak RSS after one control generation** (four questions, one copy, LaTeX
  compile + AMC prepare): TODO — expected 400-800 MB depending on the
  document.
- **Peak RSS during a scan-read batch** (N sheets, OpenCV + AMC analyse): TODO
  — the taller of the two; this is what decides whether the coexistence is
  stable.
- **DocumentBuddy p95 latency before/after the co-tenant landed**: TODO —
  compared over an hour of normal-hour traffic.
- **OOM-kill incidents in the first week**: TODO — should be zero.

The measurements above are TODO because CI publishes the image on the merge of
#175 and the bring-up on the Jetson happens after that; this ADR is updated in
a follow-up commit to `main` once the numbers exist. Until they exist, this
paragraph is HONEST rather than confident — the deploy is proceeding on the
hypothesis that the coexistence works, not on the confirmation.

**Owner + tracking**: **Miguel** fills in each of the five numbers within one
week of the Jetson bring-up. Tracked under
[issue #173](https://github.com/so77id/nalanda/issues/173) (post-#162 Jetson
deploy follow-ups) alongside the AC-4/AC-7b verifications from the sibling
WP. If a number falls outside the expected range (see each bullet), the
follow-up commit records the observation and reopens the review trigger below
rather than closing it silently.

**Deploy is `git push origin main`.** GitHub Actions runs two workflows
watching different path filters:

- `.github/workflows/server-cd.yml` (added in #162 S11) fires on
  `apps/server/**` or the Jetson sidecar files. Matrix of three arm64
  images: server, backup, monitor.
- `.github/workflows/amc-worker-cd.yml` (added in #175 S1) fires on
  `apps/amc-worker/**` alone. Own workflow — cross-compiling the AMC image
  under QEMU (Debian + texlive + Perl + OpenCV) takes ~30 min the first
  time and ~5-10 min with GHA layer cache. Not queueing a one-line server
  change behind that build is what justifies a second workflow instead of
  a matrix row.

Both push to `ghcr.io/so77id/nalanda-<name>:latest` (+ `:sha-<sha>`) and
notify the Nalanda Telegram bot. Watchtower — the SHARED instance from
DocumentBuddy's compose (already running on this Jetson under
`WATCHTOWER_LABEL_ENABLE=true`) — polls GHCR every 5 minutes and swaps
each container the moment the `:latest` digest changes. The first-time
bring-up on the box is `docker compose pull && docker compose up -d`;
after that, the operator does nothing on the Jetson unless a config
change or a schema-only migration needs `--force-recreate`.

The build path is fast because the `apps/server` Dockerfile pins its
builder stage to `--platform=${BUILDPLATFORM}` and cross-compiles Go via
`GOARCH=${TARGETARCH}` — no QEMU emulation of the Go toolchain. The two
alpine sidecars (backup, monitor) build under QEMU but ship in seconds
because their whole content is one `apk add` and three shell scripts.

**The previous shape was `git pull` on the box.** It was written down
that way in S1–S10 and dropped in S12 (this WP) because merging code and
manually re-invoking `docker compose up --build` on the Nano is exactly
the friction that keeps a test bed from becoming a real deploy target.
Rejected reasons and their answers:
- *"§C15 says CI is not due."* True when this WP started, and this WP
  itself is the case that changed it: closing five WP-C2 review triggers
  is what made "deploy" a real path, and every one of them is easier to
  keep closed with automated republishing than with a manual step.
- *"Building against a test bed is how it gets built for the wrong host."*
  The pipeline builds a plain arm64 OCI image and pushes it to GHCR — no
  Jetson-specific step, no baked-in credential, no host-dependent path.
  Moving to a VPS is a `docker compose pull` from that VPS; the
  workflow does not know which host runs it.

**Rollback stays `git revert && git push`.** CI republishes against the
reverted code, Watchtower pulls within its poll interval. An emergency
pin to a specific image without a git push (`docker pull <sha-tag>`,
`docker tag :sha-<good> :latest`, then `docker compose up -d --pull=never
--force-recreate` — the `--pull=never` is load-bearing under
`pull_policy: always`) is documented in
[`DEPLOY-JETSON.md`](../../infra/local/DEPLOY-JETSON.md) §Rollback.

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

**Compose-file shape: dev in the base, prod in an overlay** (S12 revised
this — the earlier iteration of this ADR argued for one file behind a
`jetson` profile, and S11's introduction of GHCR images made the profile
shape strictly worse). The base at `infra/local/docker-compose.yml`
holds ONLY the services a dev needs (server + amc-worker, both with
`build:`); the overlay at
`infra/deploy/jetson/docker-compose.jetson.yml` swaps `build:` for
`image: ghcr.io/…:latest`, adds `pull_policy: always`, adds the
Watchtower label to every prod service, and adds the `backup` and
`monitor` sidecars.

Reasons for the split, per iteration:
- **The asymmetry is genuine.** Prod PULLS from a registry; dev BUILDS
  locally. Overriding `build:` with `image:` (leaving both in the merged
  config, using `pull_policy: always` to decide) is exactly what
  docker-compose overlays are for. The earlier "one file, one profile"
  shape had prod services carrying `build:` they never used — a lie the
  config told itself.
- **Dev never touches the overlay.** No profile, no `COMPOSE_FILE` env,
  no way to accidentally pull `latest` from GHCR when working on a
  branch. The overlay is opt-in through the Jetson's `.env` line
  `COMPOSE_FILE=docker-compose.yml:../deploy/jetson/docker-compose.jetson.yml`.
- **Graph coupling stays intact.** The overlay references the same
  volume names and service names as the base, so the compose merge
  builds one coherent graph. The "two files drift" argument the previous
  iteration made is real when the overlay REDECLARES services from
  scratch; it does not apply when it OVERRIDES fields on services the
  base defines. The backup and monitor services (new to the overlay)
  reference `server-data:` and `server` by name — the base's names are
  authoritative for both.

The **images and scripts** the sidecars build from stay under
`infra/deploy/jetson/` because they are host-only — an alpine-based
container that never runs on a dev laptop belongs where the standards
put host-specific artifacts, not next to the shared server. The
`docs/standards/repository-structure.md` §Placement row added by this WP
names this pattern with #162 as its worked case.

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
- **Recoverable from a wiped box.** `git clone`, a `.env` from a
  password manager (including the `COMPOSE_FILE=…` line that loads the
  overlay), `docker login ghcr.io`, `docker compose pull`,
  `docker compose up -d`, then the Funnel pair (`sudo tailscale serve
  --bg --https=8443 http://127.0.0.1:8081 && sudo tailscale funnel --bg
  --https=8443 on` — `funnel` alone with no `serve` target answers
  nothing, DEPLOY-JETSON.md §The Funnel is the one home for the exact
  invocation) bring the service back on any Jetson — no rebuild, no
  waiting for the toolchain to compile on the Nano.
- **Deploy loop is short.** Merge to `main` → CI (~2–3 min) → Watchtower
  poll (≤5 min) → new container. No `ssh` step, no `git pull` step, no
  human on the box between merge and deploy. Rollback is the same shape
  via `git revert`.

### Negative

- **A single point of failure.** One instance, one box, one home power circuit.
  ADR-0034 §Consequences already accepted this and this WP does not fix it —
  a second instance needs Postgres (ADR-0007), which is a decision not due.
- **A shared box with DocumentBuddy** — now with a third heavyweight
  co-tenant (`nalanda-amc-worker`, added #175). Original text from #162
  measurement, still true: "the server's static binary is 12.2 MB and its
  idle memory is negligible next to DocumentBuddy's Python process". #175
  adds AMC's Perl + LaTeX + OpenCV, which is NOT negligible during a
  generation or a scan-read. Actual footprint and coexistence outcome
  recorded in §Decision above under the measurement block. If the Nano
  OOMs under real load, the first thing to reopen is the amc-worker
  paragraph (`docker compose stop amc-worker` cheaper than tuning
  DocumentBuddy's browser).

  **Blast-radius asymmetry under the Watchtower `:latest` trade-off.** The
  same auto-pull loop that lets `git push` reach the box in ≤5 min has an
  asymmetric consequence between the two Nalanda services if a malicious
  `:latest` ever reaches GHCR (compromised action, leaked PAT with
  `write:packages`, run-of-the-mill CI compromise): `nalanda-server` is UID
  65532 on `scratch` with a three-entry filesystem, so a swap gives an
  attacker a highly constrained shell; `nalanda-amc-worker` runs as `root`
  on a full Debian userland with `texlive`, `poppler`, `opencv` and reach
  to the compose peers, so the same swap gives r/w to `amc-work` (student
  RUTs, controls, PDFs) and network reach to server + backup + monitor.
  Recorded because the shape of the risk changed with #175; the residual
  itself was accepted at #138 and is documented in
  [`security-notes.md` §"The control worker runs as root and parses scans
  there"](../security-notes.md#the-control-worker-runs-as-root-and-parses-scans-there-accepted-2026-08-15-138).
  The cheap half of that residual (`cap_drop: [ALL]` +
  `security_opt: [no-new-privileges:true]` on the amc-worker service in
  the overlay) has not been adopted; tracked under
  [issue #173](https://github.com/so77id/nalanda/issues/173).
- **Tailscale is now a dependency for reaching Nalanda.** A Tailscale outage
  takes both services down. Free-tier Tailscale has held up for a year on the
  same box, which is the evidence this decision leans on.
- **GHCR is a new dependency.** A GitHub outage means CI cannot push, and
  Watchtower keeps the last-pulled image running (safe fallback). A GHCR
  outage during a manual `docker compose pull` fails the pull; the running
  containers stay up. Neither is a hosted-CI risk this WP introduces beyond
  what `apps/web` already carries (GitHub Pages).
- **Watchtower is a shared dependency with DocumentBuddy.** The auto-update
  loop uses DocumentBuddy's Watchtower container. Stopping DocumentBuddy
  stops auto-update for Nalanda (running containers keep serving; only new
  images stop landing). Named as an accepted trade — the alternative (a
  Watchtower per project) doubles the poll traffic and adds a coordination
  race when both observe the same daemon.
- **The `:latest` tag moves under the operator's feet.** Watchtower can
  restart a container at any minute of the day. Deliberate: this WP explicitly
  accepts uninterrupted deploys as "friends-and-family scale, no maintenance
  window needed"; SQLite-with-WAL survives a container swap because the
  volume outlives the process. Migrations apply at boot, so a schema change
  requires no separate step. A future WP that wants a maintenance window can
  add `com.centurylinklabs.watchtower.enable=false` temporarily.

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

- **~~`apps/amc-worker` needs a home too.~~** *(CLOSED by #175 — amc-worker
  joined the Jetson deploy; measurement recorded in §Decision above. If the
  numbers say the coexistence is unstable, the follow-up trigger is
  "amc-worker moves off the Nano" — probably to a VPS with its own compose
  or to a dedicated arm64 box, decided when §C15 permanent-home is decided).*
- **A second physical instance appears.** ADR-0007's Postgres exit becomes
  relevant, and this ADR's "one instance" assumption stops holding.
- **A permanent hosting decision.** §C15 closes, this ADR is superseded, and
  its measurements should be part of what supersedes it.
- **Watchtower stops being observed.** DocumentBuddy retires or its
  Watchtower is stopped and not replaced — auto-update for Nalanda dies
  silently (containers keep running the last-pulled image forever).
  Recovery: add a Watchtower service to Nalanda's overlay
  (`containrrr/watchtower` + `WATCHTOWER_LABEL_ENABLE=true` + the
  docker-sock mount; DocumentBuddy's `docker-compose.prod.yml` is the
  worked case). Reopen this ADR to record which of the two hosts owns
  the Watchtower.
- **GHCR becomes rate-limited or paid for public repos.** GitHub has
  changed its container registry pricing before; if `docker pull`s from
  the Jetson start throttling, revisit the registry choice (self-host
  registry, Docker Hub, cache proxy on the Jetson).
- **Image supply-chain hardening becomes worth the cost.** Today the CD
  workflow pins third-party actions by SHA (closes SEC-1 on the write
  side) and images ship unsigned (accepted for friends-and-family
  scale). If a signed-image loop becomes cheap to run (`cosign sign` in
  CD + Watchtower verification, or a policy engine on the Jetson), or a
  compromise reaches production via `:latest` before Watchtower's 5-min
  poll can catch it via a manual re-tag, adopt cosign — the code hook
  is one workflow step, the operator hook is one docker daemon config.
  Named because the ADR §Consequences already accepts "the `:latest`
  tag moves under the operator's feet" without a mitigation path.
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
