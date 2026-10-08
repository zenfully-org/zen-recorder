import { describe, expect, it } from 'vitest';
import { createOverlayElements } from './create-overlay-elements';

describe('createOverlayElements', () => {
  it('puts the status row and the details in one card, and the messages beside it', () => {
    const ui = createOverlayElements(document);
    expect(ui.root.className).toBe('zr-overlay');
    expect([...ui.root.children]).toEqual([ui.card, ui.toasts]);
    expect([...ui.card.children]).toEqual([ui.toggle, ui.details]);
    expect(ui.style.textContent).toContain('.zr-card');
  });

  it('makes the status row a real button that says what it opens', () => {
    const ui = createOverlayElements(document);
    expect(ui.toggle.type).toBe('button');
    expect(ui.toggle.getAttribute('aria-expanded')).toBe('false');
    expect(ui.toggle.getAttribute('aria-controls')).toBe(ui.details.id);
    expect(ui.details.id).not.toBe('');
    expect(ui.details.hidden).toBe(true);
    expect(ui.details.getAttribute('role')).toBe('group');
    expect(ui.details.getAttribute('aria-label')).toBe('Zen Recorder');
  });

  it("names the recorder in the button's accessible text, before the state and the time", () => {
    const ui = createOverlayElements(document);
    ui.status.textContent = 'Recording';
    ui.time.textContent = '01:05';
    expect(ui.toggle.textContent).toBe('Zen Recorder: Recording01:05');
    expect(ui.glyph.getAttribute('aria-hidden')).toBe('true');
  });

  it('offers each command as a labelled button with an icon', () => {
    const ui = createOverlayElements(document);
    const labels = Object.entries(ui.actions).map(([command, button]) => [
      command,
      button.textContent,
      button.type,
      button.dataset['command'],
      button.querySelector('svg') !== null,
    ]);
    expect(labels).toEqual([
      ['start', 'Record', 'button', 'start', true],
      ['pause', 'Pause', 'button', 'pause', true],
      ['resume', 'Resume', 'button', 'resume', true],
      ['stop', 'Stop', 'button', 'stop', true],
    ]);
    expect(Object.values(ui.actions).every((button) => button.className === 'zr-btn')).toBe(true);
  });

  it('lists the microphone and the video as terms and values', () => {
    const ui = createOverlayElements(document);
    const facts = ui.details.querySelector('dl');
    expect([...(facts?.querySelectorAll('dt') ?? [])].map((term) => term.textContent)).toEqual([
      'Microphone',
      'Video',
    ]);
    expect(ui.microphone.localName).toBe('dd');
    expect(ui.video.localName).toBe('dd');
    expect(ui.videoRow.contains(ui.video)).toBe(true);
  });

  it('announces messages politely to screen readers', () => {
    const ui = createOverlayElements(document);
    expect(ui.toasts.getAttribute('aria-live')).toBe('polite');
  });
});
