/**
 * The status card's stylesheet. It lives in a shadow root on the meeting page, so it carries
 * everything it needs: the colours of the extension's popup (its dark zinc theme), sizes in
 * pixels, the system font, nothing loaded from elsewhere.
 *
 * The card stays dark on every page: the meeting stages are dark, and over a light pre-join page
 * a dark card with a shadow still stands out. Each state has its own glyph shape as well as its
 * own colour (a dot, two bars, a turning arc, a ring), so colour is never the only cue. Motion is
 * opacity and transforms only, which Firefox runs on the compositor, and none at all when the
 * system asks for reduced motion. No backdrop blur: it would be redrawn with every video frame.
 */
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }

.zr-overlay {
  --zr-surface: oklch(0.21 0.006 285.885);
  --zr-raised: oklch(0.274 0.006 286.033);
  --zr-raised-hover: oklch(0.37 0.013 285.805);
  --zr-line: oklch(1 0 0 / 0.12);
  --zr-text: oklch(0.985 0 0);
  --zr-muted: oklch(0.705 0.015 286.067);
  --zr-red: oklch(0.637 0.237 25.331);
  --zr-record: oklch(0.704 0.191 22.216 / 0.6);
  --zr-record-hover: oklch(0.704 0.191 22.216 / 0.75);
  --zr-amber: oklch(0.769 0.188 70.08);
  --zr-green: oklch(0.696 0.17 162.48);
  --zr-focus: oklch(0.746 0.16 232.661);
  --zr-shadow: 0 1px 2px oklch(0 0 0 / 0.3), 0 8px 24px oklch(0 0 0 / 0.28);
  --zr-origin-x: right;
  --zr-origin-y: top;
  position: fixed;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: calc(100vw - 16px);
  font: 400 13px/18px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  color: var(--zr-text);
  pointer-events: none;
}
.zr-overlay[data-horizontal="left"] { align-items: flex-start; --zr-origin-x: left; }
.zr-overlay[data-vertical="bottom"] { flex-direction: column-reverse; --zr-origin-y: bottom; }

.zr-card {
  display: none;
  flex-direction: column;
  pointer-events: auto;
  user-select: none;
  touch-action: none;
  background: var(--zr-surface);
  border: 1px solid var(--zr-line);
  border-radius: 17px;
  box-shadow: var(--zr-shadow);
  transform-origin: var(--zr-origin-y) var(--zr-origin-x);
}
.zr-card[data-visible="true"] { display: flex; }
.zr-card[data-expanded="true"] { width: 280px; max-width: 100%; border-radius: 14px; animation: zr-open 160ms ease-out; }
.zr-overlay[data-vertical="bottom"] .zr-card { flex-direction: column-reverse; }
.zr-overlay[data-dragging] .zr-card {
  animation: none;
  cursor: grabbing;
  box-shadow: 0 2px 4px oklch(0 0 0 / 0.3), 0 16px 40px oklch(0 0 0 / 0.38);
}

.zr-toggle {
  all: unset;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 7px;
  border-radius: 16px;
  cursor: pointer;
  white-space: nowrap;
}
.zr-toggle:focus-visible, .zr-btn:focus-visible { outline: 2px solid var(--zr-focus); outline-offset: 2px; }
.zr-card[data-expanded="true"] .zr-toggle { height: 44px; padding: 0 10px 0 12px; border-radius: 13px; }

.zr-sr, .zr-card:not([data-expanded="true"]) .zr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.zr-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.zr-time { margin-right: 5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.zr-time:empty { display: none; }
.zr-card[data-expanded="true"] .zr-time { margin-right: 0; color: var(--zr-muted); font-weight: 500; }
.zr-icon-chevron { display: none; width: 16px; height: 16px; flex: none; color: var(--zr-muted); }
.zr-card[data-expanded="true"] .zr-icon-chevron { display: block; }
.zr-overlay[data-vertical="bottom"] .zr-icon-chevron { transform: rotate(180deg); }

.zr-glyph { position: relative; flex: none; width: 18px; height: 18px; color: var(--zr-muted); }
.zr-glyph::before, .zr-glyph::after { content: ""; position: absolute; border-radius: 50%; }
.zr-glyph::before { inset: 0; border: 1.5px solid currentColor; opacity: 0.5; }
.zr-glyph::after { inset: 6px; background: currentColor; }
.zr-card[data-tone="recording"] .zr-glyph { color: var(--zr-red); }
.zr-card[data-tone="recording"] .zr-glyph::before {
  border-color: transparent;
  background: currentColor;
  opacity: 0.3;
  animation: zr-halo 1.6s ease-out infinite;
}
.zr-card[data-tone="recording"] .zr-glyph::after { inset: 5px; }
.zr-card[data-tone="paused"] .zr-glyph { color: var(--zr-amber); }
.zr-card[data-tone="paused"] .zr-glyph::after {
  inset: 5px 5.5px;
  border-radius: 0;
  background: none;
  border-left: 2.5px solid currentColor;
  border-right: 2.5px solid currentColor;
}
.zr-card[data-tone="saving"] .zr-glyph { color: var(--zr-text); }
.zr-card[data-tone="saving"] .zr-glyph::before {
  border-color: oklch(1 0 0 / 0.2);
  border-top-color: currentColor;
  opacity: 1;
  animation: zr-spin 0.9s linear infinite;
}
.zr-card[data-tone="saving"] .zr-glyph::after { display: none; }

.zr-details {
  display: grid;
  gap: 12px;
  padding: 12px;
  border-top: 1px solid var(--zr-line);
  cursor: grab;
  transition: opacity 160ms ease-out, translate 160ms ease-out;
}
.zr-overlay[data-vertical="bottom"] .zr-details { border-top: 0; border-bottom: 1px solid var(--zr-line); }
@starting-style {
  .zr-details { opacity: 0; translate: 0 -6px; }
  .zr-overlay[data-vertical="bottom"] .zr-details { translate: 0 6px; }
}
.zr-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 16px; margin: 0; }
.zr-fact { display: contents; }
.zr-facts dt { color: var(--zr-muted); }
.zr-facts dd { margin: 0; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.zr-actions { display: flex; gap: 8px; }
.zr-btn {
  all: unset;
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--zr-raised);
  color: var(--zr-text);
  font-weight: 500;
  cursor: pointer;
}
.zr-btn:hover { background: var(--zr-raised-hover); }
.zr-btn[data-command="start"] { background: var(--zr-record); color: oklch(1 0 0); }
.zr-btn[data-command="start"]:hover { background: var(--zr-record-hover); }
.zr-btn .zr-icon { width: 14px; height: 14px; flex: none; }
.zr-btn[data-command="stop"] .zr-icon { color: var(--zr-red); }

.zr-toasts { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.zr-overlay[data-horizontal="left"] .zr-toasts { align-items: flex-start; }
.zr-overlay[data-vertical="bottom"] .zr-toasts { flex-direction: column-reverse; }
.zr-toast {
  display: flex;
  gap: 10px;
  max-width: 320px;
  padding: 10px 12px;
  border: 1px solid var(--zr-line);
  border-radius: 12px;
  background: var(--zr-surface);
  box-shadow: var(--zr-shadow);
  overflow-wrap: anywhere;
  pointer-events: auto;
  transition: opacity 160ms ease-out, translate 160ms ease-out;
}
@starting-style { .zr-toast { opacity: 0; translate: 0 -4px; } }
.zr-toast::before {
  content: "";
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--zr-green);
}
.zr-toast[data-kind="error"] { border-color: oklch(0.637 0.237 25.331 / 0.6); }
.zr-toast[data-kind="error"]::before { background: var(--zr-red); }

@keyframes zr-halo {
  from { transform: scale(0.55); opacity: 0.55; }
  to { transform: scale(1.2); opacity: 0; }
}
@keyframes zr-spin { to { transform: rotate(1turn); } }
@keyframes zr-open {
  from { transform: scale(0.97); opacity: 0.7; }
  to { transform: none; opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .zr-overlay *, .zr-overlay *::before, .zr-overlay *::after {
    animation: none !important;
    transition: none !important;
  }
}
@media (forced-colors: active) {
  .zr-card, .zr-toast { border-color: CanvasText; }
  .zr-glyph { forced-color-adjust: none; }
}
`;

export function getOverlayStyle(): string {
  return CSS;
}
