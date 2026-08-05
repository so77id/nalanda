# ADR-0008: Live sessions — dumb relay with a generic event envelope

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D9, D20, D21, D22)

## Context

Hito 1's flagship feature: the professor teaches and students' browsers follow. The
dream grows far beyond that (component-level sync, professor mirroring a student's
session, live quizzes, raised hands), so the wire design must extend without
rewriting the server — while the server itself stays minimal (ADR-0001).

## Decision

- All session traffic travels in a **generic envelope**: `{session, seq, type, payload}`.
- The server is a **dumb relay**: it never inspects payloads; it fans events out to
  session members and keeps only the last state in memory so late joiners snap to
  current position. No persistence — a server restart ends live sessions.
- **v1 implements exactly one event type** (`location`: current document, mode,
  slide position) in one direction (professor → students). Following students see
  what the professor sees across document jumps (wiki-wide). Students may detach to
  explore freely and re-attach to sync.
- Sockets (student↔server, professor↔server) are **bidirectional-capable**; future
  features are new event types (component syncs, 1:1 mirror), not new architecture.
- Session UX: professor opens a session (login required, ADR-0009) and gets a join
  code; a slim persistent banner shows the code + connected-students counter and
  later evolves into the professor toolbar.

## Alternatives considered

- **Typed server** (server understands each feature's events): every new sync needs
  server work; violates the relay philosophy. Rejected.
- **Peer-to-peer (WebRTC)**: no server fan-out cost, but NAT/scale complexity and no
  authoritative late-join state. Rejected for v1.

## Consequences

- New sync features ship mostly as frontend + a new event type.
- Transport choice (WebSocket vs SSE+POST), exact message schema, and reconnection
  semantics are decided at the hito-1 spec.
- Component contract reserves an optional sync interface (ADR-0010) declaring which
  event types a component emits/consumes.
