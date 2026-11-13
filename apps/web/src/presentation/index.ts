// Public seam of the presentation feature (import direction rule, frontend-code-style.md).
// NOTE: importing this seam evaluates PresentationPage and, transitively, the
// content registry (accepted for v0.1 — components only need useMode; revisit
// with a leaf seam if module-eval cost ever matters).
export { ModeProvider } from './ModeProvider';
export { useMode } from './useMode';
export { PresentationPage } from './PresentationPage';
export { PresentableSectionsWrapper } from './PresentableSectionsWrapper';
// A widget on a slide asks it before taking the keyboard (StepShow, #357).
export { isTypingTarget } from './typingTarget';
export { WALK_TAKES_KEYS_ON_ARRIVAL } from './walkKeys';
