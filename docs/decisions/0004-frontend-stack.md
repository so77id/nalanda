# ADR-0004: Frontend stack — React + TypeScript + Vite + Tailwind + framer-motion

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D10, D11, D26)

## Context

The new app is built from scratch (the POC is a quarry: widgets get ported piece by
piece as content needs them). The platform is component-based to its core — documents
are literally built from components (ADR-0003). The frontend must deploy as a fully
static site (GitHub Pages).

## Decision

- **React** — component model; POC widgets are React and port directly.
- **TypeScript** — all new frontend code. Style is tightly bounded (ADR-0005).
- **Vite** — dev server + static bundler (compiles TS/JSX/MDX; outputs static files
  for Pages). Not a framework; no server rendering.
- **Tailwind CSS** — styling as utility classes inside components; design-system
  tokens (palette, spacing) defined in the catalog standard.
- **framer-motion** — THE animation library. No other animation library may be added.

## Alternatives considered

- **Next.js**: adds a rendering server — contradicts static-frontend + minimal-server
  (ADR-0001); rejected.
- **Vue/Svelte**: no benefit worth discarding proven React widgets and the strongest
  agent/ecosystem support.
- **Plain CSS / CSS-in-JS**: style sprawl vs runtime cost; Tailwind keeps styles
  colocated and constrained, which also limits agent improvisation.

## Consequences

- POC widgets get typed as they enter (porting cost paid per piece).
- The static build remains deployable on GitHub Pages for free.
- One animation idiom across every component keeps the catalog coherent.
