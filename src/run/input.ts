// Keyboard and touch controls for the run mode.
// WASD / arrows move (screen directions), Space jumps, E opens chests, Esc pauses,
// 1-3 pick a card, R rerolls. Touch: drag on the left for a joystick, buttons on the right.
import { RunInput } from './run';

export interface RunControls {
  onPause: () => void;
  onCard: (i: number) => void;
  onReroll: () => void;
  onAuto: () => void;
  onCore: () => void;
}

export function setupRunInput(input: RunInput, area: HTMLElement, ctl: RunControls) {
  const held = new Set<string>();
  let joy: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  const KEYS: Record<string, string> = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  };
  window.addEventListener('keydown', (e) => {
    const k = KEYS[e.code];
    if (k) {
      held.add(k);
      e.preventDefault();
    }
    if (e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      input.jump = true;
    }
    if (e.code === 'KeyE') input.interact = true;
    if (e.code === 'Escape' || e.code === 'KeyP') ctl.onPause();
    if (e.code === 'KeyR') ctl.onReroll();
    if (e.code === 'KeyQ') ctl.onAuto();
    if (e.code === 'KeyF') ctl.onCore();
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0) ctl.onCard(n);
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYS[e.code];
    if (k) held.delete(k);
  });
  window.addEventListener('blur', () => held.clear());
  // stop long-press menus and text selection from eating touches
  area.addEventListener('contextmenu', (e) => e.preventDefault());

  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  const release = () => {
    joy = null;
    stick?.classList.add('hidden');
    if (knob) knob.style.transform = '';
  };
  // a floating stick: starts wherever you put your thumb (except on buttons and cards)
  area.addEventListener(
    'touchstart',
    (e) => {
      // a finger the browser never told us was lifted: forget it so the stick can't get stuck
      if (joy && !Array.from(e.touches).some((t) => t.identifier === joy!.id)) release();
      if (joy) return;
      const t = e.changedTouches[0];
      const target = t.target as HTMLElement | null;
      if (target?.closest('button, .card, .overlay-screen:not(.hidden), a, input, label')) return;
      const r = area.getBoundingClientRect();
      joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
      if (stick) {
        stick.style.left = `${t.clientX - r.left}px`;
        stick.style.top = `${t.clientY - r.top}px`;
        stick.classList.remove('hidden');
      }
      e.preventDefault();
    },
    { passive: false },
  );
  // moves and releases are caught on the whole window, so lifting your thumb anywhere counts
  window.addEventListener(
    'touchmove',
    (e) => {
      if (!joy) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== joy.id) continue;
        let dx = t.clientX - joy.ox;
        let dy = t.clientY - joy.oy;
        const l = Math.hypot(dx, dy);
        // the stick follows your thumb if you drag past its edge
        if (l > 50) {
          joy.ox += (dx / l) * (l - 50);
          joy.oy += (dy / l) * (l - 50);
          dx = (dx / l) * 50;
          dy = (dy / l) * 50;
          const r = area.getBoundingClientRect();
          if (stick) {
            stick.style.left = `${joy.ox - r.left}px`;
            stick.style.top = `${joy.oy - r.top}px`;
          }
        }
        joy.dx = dx / 50;
        joy.dy = dy / 50;
        if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      e.preventDefault();
    },
    { passive: false },
  );
  const end = (e: TouchEvent) => {
    if (!joy) return;
    const id = joy.id;
    if (Array.from(e.changedTouches).some((t) => t.identifier === id) || !Array.from(e.touches).some((t) => t.identifier === id)) release();
  };
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', release);
  document.getElementById('jumpbtn')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input.jump = true;
  });
  document.getElementById('usebtn')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input.interact = true;
  });

  // screen direction -> world direction for the isometric view
  const toWorld = (sx: number, sy: number) => {
    const x = (sx + 2 * sy) / 2;
    const y = (2 * sy - sx) / 2;
    const l = Math.hypot(x, y);
    return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  };
  return function poll(skipMove: boolean) {
    if (skipMove) return;
    let sx = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    let sy = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
    let mag = sx || sy ? 1 : 0;
    if (joy && Math.hypot(joy.dx, joy.dy) > 0.2) {
      sx = joy.dx;
      sy = joy.dy;
      mag = Math.min(1, Math.hypot(joy.dx, joy.dy));
    }
    const d = toWorld(sx, sy);
    input.moveX = d.x * mag;
    input.moveY = d.y * mag;
  };
}
