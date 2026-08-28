// The catalog's own payload, deliberately kept OFF the components seam.
//
// Every entry here is prose written for component authors — descriptions, prop
// tables, example snippets — and `/catalog` is its only reader. Imported from
// `index.ts` it rode in the payload of every course page instead, including
// documents nobody opens the catalog from (#122; ADR-0018 §Consequences has the
// bytes, and they grow with every component). The seam
// reaches it through `loadCatalogEntries()`; nothing else may name this module,
// and `src/architecture.test.ts` walks the eager graph to keep it that way.
import type { CatalogEntry } from '../lib/catalogEntry';

import { benchmarkCatalogEntry } from './interactive/Benchmark.catalog';
import { callStackCatalogEntry } from './interactive/CallStack.catalog';
import { codeEditorCatalogEntry } from './interactive/CodeEditor.catalog';
import { complexityCounterCatalogEntry } from './interactive/ComplexityCounter.catalog';
import { complexityExerciseCatalogEntry } from './interactive/ComplexityExercise.catalog';
import { complexityHierarchyCatalogEntry } from './interactive/ComplexityHierarchy.catalog';
import { hanoiPlaygroundCatalogEntry } from './interactive/HanoiPlayground.catalog';
import { mathPlotCatalogEntry } from './interactive/MathPlot.catalog';
import { exerciseCatalogEntry } from './interactive/Exercise.catalog';
import { explanationCatalogEntry } from './interactive/Explanation.catalog';
import { fibIterStepsCatalogEntry } from './interactive/FibIterSteps.catalog';
import { fibMemoStepsCatalogEntry } from './interactive/FibMemoSteps.catalog';
import { fibTabStepsCatalogEntry } from './interactive/FibTabSteps.catalog';
import { mermaidCatalogEntry } from './interactive/Mermaid.catalog';
import { predictOutputCatalogEntry } from './interactive/PredictOutput.catalog';
import { questionCatalogEntry } from './interactive/Question.catalog';
import { questionsCatalogEntry } from './interactive/Questions.catalog';
import { recursionTreeCatalogEntry } from './interactive/RecursionTree.catalog';
import { memoryVisualCatalogEntry } from './interactive/MemoryVisual.catalog';
import { stepCatalogEntry, stepShowCatalogEntry } from './interactive/StepShow.catalog';
import { figureCatalogEntry } from './media/Figure.catalog';
import { mathCatalogEntry } from './media/Math.catalog';
import { sheetEmbedCatalogEntry } from './media/SheetEmbed.catalog';
import { videoEmbedCatalogEntry } from './media/VideoEmbed.catalog';
import { mosaicCatalogEntry } from './structure/Mosaic.catalog';
import { sectionBreakCatalogEntry } from './structure/SectionBreak.catalog';
import { sideBySideCatalogEntry } from './structure/SideBySide.catalog';
import { slideCatalogEntry } from './structure/Slide.catalog';
import { splitCatalogEntry } from './structure/Split.catalog';

/** Every catalog entry this feature ships (colocated *.catalog.tsx files). */
export const catalogEntries: CatalogEntry[] = [
  slideCatalogEntry,
  sectionBreakCatalogEntry,
  sideBySideCatalogEntry,
  splitCatalogEntry,
  mosaicCatalogEntry,
  figureCatalogEntry,
  mathCatalogEntry,
  sheetEmbedCatalogEntry,
  videoEmbedCatalogEntry,
  codeEditorCatalogEntry,
  exerciseCatalogEntry,
  mermaidCatalogEntry,
  predictOutputCatalogEntry,
  benchmarkCatalogEntry,
  complexityCounterCatalogEntry,
  complexityExerciseCatalogEntry,
  complexityHierarchyCatalogEntry,
  mathPlotCatalogEntry,
  questionsCatalogEntry,
  questionCatalogEntry,
  explanationCatalogEntry,
  recursionTreeCatalogEntry,
  callStackCatalogEntry,
  hanoiPlaygroundCatalogEntry,
  stepShowCatalogEntry,
  stepCatalogEntry,
  fibMemoStepsCatalogEntry,
  fibTabStepsCatalogEntry,
  fibIterStepsCatalogEntry,
  memoryVisualCatalogEntry,
];
