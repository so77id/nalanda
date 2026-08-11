import type { ComponentType } from 'react';

/** The four editable catalog families (ADR-0010); ids double as route segments. */
export type CatalogFamily = 'estructura' | 'semanticos' | 'interactivos' | 'media';

export interface CatalogPropDef {
  name: string;
  type: string;
  default?: string;
  description: string;
}

export interface CatalogExample {
  title: string;
  /** Source snippet shown beside the live render (plain <pre>, decided in #65). */
  code: string;
  /** A component, not a call: each example gets its own React instance (own hooks/state). */
  render: ComponentType;
}

/**
 * The catalog contract every content component ships (ADR-0010): colocated as
 * `<Component>.catalog.tsx` beside the component, exported through the owning
 * feature's seam. Lives in lib/ so entries never import the catalog feature
 * (which would close a feature cycle) — same reasoning as componentMeta.
 */
export interface CatalogEntry {
  /** Must match the MDX-registered name (the completeness test keys on it). */
  name: string;
  family: CatalogFamily;
  description: string;
  whenToUse: string;
  props: CatalogPropDef[];
  examples: CatalogExample[];
}
