import { Input, Vec } from './game';

/**
 * Keyboard, mouse and touch controls.
 *
 * Desktop: WASD / arrows move (screen directions), mouse aims, hold left click (or J) to attack,
 * Space uses the class ability (parry / sprint / blink), 1/2/3 cast skills toward the mouse, Q toggles AUTO.
 * Touch: drag anywhere on the left side of the battle area for a joystick, buttons on the right.
 */
export function setupInput(
  input: Input,
  canvas: HTMLCanvasElement,
  screenToWorld: (x: number, y: number) => Vec,
  onToggleAuto: () => void,
) {
  const held = new Set<string>();
  let mouse: { x: number; y: number } | null = null;
  let mouseDown = false;
  let joy: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;

  const isTyping = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
  };

  const KEYS: Record<string, string> = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    KeyJ: 'attack',
  };

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    const k = KEYS[e.code];
    if (k) {
      held.add(k);
      e.preventDefault();
    }
    const skill = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (skill >= 0 && !e.repeat) input.skills[skill] = true;
    if (e.code === 'KeyQ' && !e.repeat) onToggleAuto();
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) input.evade = true;
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYS[e.code];
    if (k) held.delete(k);
  });
  window.addEventListener('blur', () => {
    held.clear();
    mouseDown = false;
  });

  // Mouse aim + click to attack
  canvas.addEventListener('mousemove', (e) => {
    const r = (canvas.parentElement ?? canvas).getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  canvas.addEventListener('mouseleave', () => {
    mouse = null;
    mouseDown = false;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouseDown = true;
  });
  window.addEventListener('mouseup', () => (mouseDown = false));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Touch joystick on the canvas
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  canvas.addEventListener('touchstart', (e) => {
    if (joy) return;
    const t = e.changedTouches[0];
    const r = (canvas.parentElement ?? canvas).getBoundingClientRect();
    joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
    if (stick) {
      stick.style.left = `${t.clientX - r.left}px`;
      stick.style.top = `${t.clientY - r.top}px`;
      stick.classList.remove('hidden');
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!joy) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== joy.id) continue;
      let dx = t.clientX - joy.ox;
      let dy = t.clientY - joy.oy;
      const l = Math.hypot(dx, dy);
      const max = 50;
      if (l > max) {
        dx = (dx / l) * max;
        dy = (dy / l) * max;
      }
      joy.dx = dx / max;
      joy.dy = dy / max;
      if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    e.preventDefault();
  }, { passive: false });
  const endTouch = (e: TouchEvent) => {
    if (!joy) return;
    const id = joy.id;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === id) {
        joy = null;
        stick?.classList.add('hidden');
        if (knob) knob.style.transform = '';
      }
    }
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  // On-screen buttons: data-key="attack"
  document.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
    const k = el.dataset.key!;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      held.add('btn-' + k);
      el.classList.add('pressed');
    });
    const off = () => {
      held.delete('btn-' + k);
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  });

  // Skill buttons
  document.querySelectorAll<HTMLElement>('[data-skill]').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.skills[Number(el.dataset.skill)] = true;
    });
  });

  // Screen direction -> world direction for the isometric view
  const toWorld = (sx: number, sy: number) => {
    const x = (sx + 2 * sy) / 2;
    const y = (2 * sy - sx) / 2;
    const l = Math.hypot(x, y);
    return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  };

  return function poll() {
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
    input.attack = held.has('attack') || held.has('btn-attack') || mouseDown;
    input.aim = mouse ? screenToWorld(mouse.x, mouse.y) : null;
  };
}
