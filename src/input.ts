import { SKILLS } from './data';
import { Input } from './game';

/**
 * Keyboard + touch controls. Writes into the game's Input object every frame.
 *
 * Keys: A/D or arrows to move, W/Up/Space to jump, S/Down + jump to drop through a platform,
 * J/Z to attack, 1/2/3 for skills, Q to toggle AUTO.
 */
export function setupInput(input: Input, onToggleAuto: () => void) {
  const held = new Set<string>();

  const isTyping = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
  };

  const KEYS: Record<string, string> = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    ArrowDown: 'down', KeyS: 'down',
    KeyJ: 'attack', KeyZ: 'attack', KeyX: 'attack',
  };

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    const k = KEYS[e.code];
    if (k) {
      held.add(k);
      e.preventDefault();
    }
    const skill = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (skill >= 0 && skill < SKILLS.length && !e.repeat) input.skills[skill] = true;
    if (e.code === 'KeyQ' && !e.repeat) onToggleAuto();
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYS[e.code];
    if (k) held.delete(k);
  });
  window.addEventListener('blur', () => held.clear());

  // Touch / mouse buttons: any element with data-key="left|right|jump|down|attack"
  document.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
    const k = el.dataset.key!;
    const on = (e: Event) => {
      e.preventDefault();
      held.add('touch-' + k);
      el.classList.add('pressed');
    };
    const off = () => {
      held.delete('touch-' + k);
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  });

  // Skill buttons
  document.querySelectorAll<HTMLElement>('[data-skill]').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.skills[Number(el.dataset.skill)] = true;
    });
  });

  return function poll() {
    const has = (k: string) => held.has(k) || held.has('touch-' + k);
    input.left = has('left');
    input.right = has('right');
    input.jump = has('jump');
    input.down = has('down');
    input.attack = has('attack');
  };
}
