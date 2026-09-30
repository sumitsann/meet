// Meet remote-control agent.
// Runs on the computer that SHARES its screen. The Meet tab forwards input events from
// viewers you've approved; this process turns them into real OS mouse/keyboard input.
//
// Security model:
//   - listens on 127.0.0.1 only (not reachable from the network)
//   - accepts WebSocket connections only from ALLOWED_ORIGINS (your Meet app's origin)
//   - one client at a time
//   - the Meet tab only forwards input from peers you explicitly clicked "Allow" for
//   - Ctrl+C here is the hard kill switch
import { WebSocketServer } from 'ws';
import { Button, Key, Point, keyboard, mouse, screen } from '@nut-tree-fork/nut-js';

const PORT = Number(process.env.AGENT_PORT) || 47800;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://meet-rurx.onrender.com,http://localhost:5173,http://localhost:3001')
  .split(',')
  .map((s) => s.trim());

mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

// KeyboardEvent.code -> nut-js Key
const CODE_MAP = {
  Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Backspace: 'Backspace', Tab: 'Tab', Space: 'Space',
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftControl', ControlRight: 'RightControl',
  AltLeft: 'LeftAlt', AltRight: 'RightAlt', MetaLeft: 'LeftSuper', MetaRight: 'RightSuper',
  Minus: 'Minus', Equal: 'Equal', BracketLeft: 'LeftBracket', BracketRight: 'RightBracket',
  Backslash: 'Backslash', Semicolon: 'Semicolon', Quote: 'Quote', Comma: 'Comma', Period: 'Period',
  Slash: 'Slash', Backquote: 'Grave', CapsLock: 'CapsLock', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ContextMenu: 'Menu',
  PrintScreen: 'Print', ScrollLock: 'ScrollLock', Pause: 'Pause', NumLock: 'NumLock',
  NumpadAdd: 'Add', NumpadSubtract: 'Subtract', NumpadMultiply: 'Multiply', NumpadDivide: 'Divide',
  NumpadDecimal: 'Decimal',
};
function toKey(code = '', key = '') {
  // Some synthetic/IME events have no `code`; fall back to the character.
  if (!code && /^[a-z0-9]$/i.test(key)) code = /\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
  let name = CODE_MAP[code];
  if (!name) {
    let m;
    if ((m = code.match(/^Key([A-Z])$/))) name = m[1];
    else if ((m = code.match(/^Digit(\d)$/))) name = `Num${m[1]}`;
    else if ((m = code.match(/^Numpad(\d)$/))) name = `NumPad${m[1]}`;
    else if (/^F\d{1,2}$/.test(code)) name = code;
  }
  return name != null ? Key[name] : undefined;
}

const BUTTON = { left: Button.LEFT, middle: Button.MIDDLE, right: Button.RIGHT };

// Wheel units differ per OS backend: Windows = raw wheel delta (120/notch),
// macOS = pixels, Linux = discrete clicks.
function wheelAmount(px) {
  if (process.platform === 'win32') return Math.round(px * 1.2);
  if (process.platform === 'linux') return Math.max(1, Math.round(Math.abs(px) / 100)) * Math.sign(px);
  return Math.round(px);
}

// ---- state for cleanup ----
const heldKeys = new Set();
const heldButtons = new Set();
let size = { w: await screen.width(), h: await screen.height() };
setInterval(async () => {
  size = { w: await screen.width(), h: await screen.height() }; // follow resolution changes
}, 5000).unref();

const toPoint = (x, y) =>
  new Point(Math.round(Math.min(Math.max(x, 0), 1) * (size.w - 1)), Math.round(Math.min(Math.max(y, 0), 1) * (size.h - 1)));

async function releaseAll() {
  for (const k of heldKeys) await keyboard.releaseKey(k).catch(() => {});
  for (const b of heldButtons) await mouse.releaseButton(b).catch(() => {});
  heldKeys.clear();
  heldButtons.clear();
}

async function apply(e) {
  switch (e.t) {
    case 'move':
      return mouse.setPosition(toPoint(e.x, e.y));
    case 'down':
    case 'up': {
      const b = BUTTON[e.b] ?? Button.LEFT;
      if (typeof e.x === 'number') await mouse.setPosition(toPoint(e.x, e.y));
      if (e.t === 'down') {
        heldButtons.add(b);
        return mouse.pressButton(b);
      }
      heldButtons.delete(b);
      return mouse.releaseButton(b);
    }
    case 'wheel':
      if (e.dy) await (e.dy > 0 ? mouse.scrollDown(wheelAmount(e.dy)) : mouse.scrollUp(wheelAmount(-e.dy)));
      if (e.dx) await (e.dx > 0 ? mouse.scrollRight(wheelAmount(e.dx)) : mouse.scrollLeft(wheelAmount(-e.dx)));
      return;
    case 'key': {
      const k = toKey(e.code, e.key);
      if (k === undefined) return;
      if (e.down) {
        heldKeys.add(k);
        return keyboard.pressKey(k);
      }
      heldKeys.delete(k);
      return keyboard.releaseKey(k);
    }
    case 'reset':
      return releaseAll();
  }
}

// Apply events strictly in order; collapse bursts of mouse moves into the latest one.
let queue = [];
let running = false;
function enqueue(e) {
  if (e.t === 'move' && queue.at(-1)?.t === 'move') queue[queue.length - 1] = e;
  else queue.push(e);
  if (!running) drain();
}
async function drain() {
  running = true;
  while (queue.length) {
    const e = queue.shift();
    try {
      await apply(e);
    } catch (err) {
      console.error('input error:', err.message);
    }
  }
  running = false;
}

// ---- server ----
let active = null;
const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: PORT,
  verifyClient: ({ origin }) => {
    const ok = ALLOWED_ORIGINS.includes(origin);
    if (!ok) console.warn(`Rejected connection from origin ${origin}`);
    return ok;
  },
});

wss.on('connection', (ws, req) => {
  if (active) {
    ws.close(1008, 'Another Meet tab is already connected');
    return;
  }
  active = ws;
  console.log(`Meet tab connected (${req.headers.origin}). Remote input is live — Ctrl+C to stop.`);
  ws.on('message', (raw) => {
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      return;
    }
    if (e && typeof e.t === 'string') enqueue(e);
  });
  ws.on('close', async () => {
    active = null;
    queue = [];
    await releaseAll();
    console.log('Meet tab disconnected.');
  });
});

console.log(`Meet control agent on ws://127.0.0.1:${PORT}`);
console.log(`Screen: ${size.w}x${size.h}   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);

process.on('SIGINT', async () => {
  await releaseAll();
  process.exit(0);
});
