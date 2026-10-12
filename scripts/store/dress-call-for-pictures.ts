/**
 * Makes the fake Google Meet page look like a call for the store's pictures, without changing the
 * fixture file, whose test buttons, frame counters and test patterns the end-to-end scenarios
 * read. Run it on the page before joining the call.
 */
import type { Page } from 'puppeteer';

/**
 * Hides what only a test bench shows: the heading, the intro, the test buttons, the page's own
 * toolbar and log, and the self view's marker chip. The call and the status card stay, and the
 * call sits in the middle of the window, as a meeting page lays it out.
 */
const STYLE = `
  body { margin: 0 24px; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; }
  body > h1, body > p, #log, .tile .google-symbols { display: none !important; }
  #peer { position: absolute; }
`;

/**
 * Gives every camera tile, now and as tiles come, a calm picture in place of the fake camera's
 * frame counter: a silhouette on a soft wall, its colours chosen by the person's name, and a plain
 * slide for a screen share. The recorder records what the page shows, so the saved recording has
 * the same tiles. A page script, not a function: tsx would add helpers the page does not have.
 */
const CALM_TILES = `(() => {
  const LOOKS = {
    'You': { wall: ['#efe5d6', '#dbc8ad'], figure: '#a68f77' },
    'Remote Person': { wall: ['#e0e9ed', '#bccdd5'], figure: '#7c96a2' },
  };
  const OTHER_LOOKS = [
    { wall: ['#e4ece0', '#c4d3bb'], figure: '#86997a' },
    { wall: ['#ece2ea', '#d3c0cf'], figure: '#9a8193' },
  ];
  function lookOf(name) {
    if (LOOKS[name]) return LOOKS[name];
    let sum = 0;
    for (const char of name) sum += char.codePointAt(0);
    return OTHER_LOOKS[sum % OTHER_LOOKS.length];
  }
  function paintPerson(c, w, h, look) {
    const wall = c.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, look.wall[0]);
    wall.addColorStop(1, look.wall[1]);
    c.fillStyle = wall;
    c.fillRect(0, 0, w, h);
    c.fillStyle = look.figure;
    c.beginPath();
    c.ellipse(w / 2, h * 1.12, w * 0.28, h * 0.5, 0, 0, Math.PI * 2);
    c.fill();
    c.fillRect(w / 2 - w * 0.035, h * 0.5, w * 0.07, h * 0.2);
    c.beginPath();
    c.ellipse(w / 2, h * 0.45, w * 0.095, h * 0.2, 0, 0, Math.PI * 2);
    c.fill();
  }
  function paintSlide(c, w, h) {
    c.fillStyle = '#f7f8fa';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1e2a47';
    c.fillRect(w * 0.08, h * 0.12, w * 0.46, h * 0.08);
    c.fillStyle = '#c9cfdb';
    for (let row = 0; row < 4; row++) c.fillRect(w * 0.08, h * (0.32 + row * 0.12), w * (0.7 - row * 0.1), h * 0.04);
  }
  function calmStream(name, share) {
    const canvas = document.createElement('canvas');
    canvas.width = share ? 1280 : 640;
    canvas.height = share ? 720 : 360;
    const c = canvas.getContext('2d');
    const look = lookOf(name);
    const paint = () => (share ? paintSlide(c, canvas.width, canvas.height) : paintPerson(c, canvas.width, canvas.height, look));
    paint();
    // A canvas stream sends a frame only when the canvas is painted.
    setInterval(paint, 500);
    return canvas.captureStream(5);
  }
  const calmed = new WeakSet();
  function calm(tile) {
    const video = tile.querySelector('video');
    if (!video || calmed.has(video)) return;
    calmed.add(video);
    const name = tile.querySelector('.notranslate')?.textContent ?? '';
    video.srcObject = calmStream(name, tile.dataset.tileMediaId === 'm-share');
    video.play().catch(() => {});
  }
  const stage = document.getElementById('stage');
  const calmAll = () => { for (const tile of stage.children) calm(tile); };
  calmAll();
  new MutationObserver(calmAll).observe(stage, { childList: true });
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(STYLE)};
  document.head.append(style);
})()`;

/** Dresses the fake Meet page in `page` for the pictures: the capture style and the calm tiles. */
export async function dressCallForPictures(page: Page): Promise<void> {
  await page.evaluate(CALM_TILES);
}
