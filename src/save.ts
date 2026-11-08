import { JobId } from './data';
import { GameState, migrate, newState } from './state';

/**
 * All saving goes through this interface. In the browser it uses localStorage.
 * For a desktop build (Tauri) swap in a file-based implementation here and
 * nothing else in the game needs to change.
 */
export interface SaveStorage {
  read(key: string): string | null;
  write(key: string, data: string): void;
  remove(key: string): void;
}

export const localSaveStorage: SaveStorage = {
  read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, data) {
    try {
      localStorage.setItem(key, data);
    } catch {
      /* storage full or blocked; ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

let storage: SaveStorage = localSaveStorage;
export function setSaveStorage(s: SaveStorage) {
  storage = s;
}

// ---------------- Character slots ----------------
export const SLOT_COUNT = 3;
const slotKey = (i: number) => `idle-rpg-char-${i}`;
// Saves from before character slots. v1 is the side-scroller's (it still uses it at /side/).
const LEGACY_KEYS = ['idle-rpg-save-v2', 'idle-rpg-save-v1'];

let activeSlot = 0;
export function setActiveSlot(i: number) {
  activeSlot = i;
}
export function getActiveSlot() {
  return activeSlot;
}

export function readSlot(i: number): GameState | null {
  const raw = storage.read(slotKey(i));
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeSlot(i: number, state: GameState) {
  storage.write(slotKey(i), JSON.stringify(state));
}

export function deleteSlot(i: number) {
  storage.remove(slotKey(i));
}

export function createCharacter(i: number, name: string, job: JobId): GameState {
  const s = newState(name, job);
  writeSlot(i, s);
  return s;
}

/** Wipes a character back to level 1 but keeps its name and job. */
export function resetCharacter(i: number): GameState | null {
  const old = readSlot(i);
  if (!old) return null;
  const s = newState(old.name, old.job);
  s.settings = { ...old.settings };
  writeSlot(i, s);
  return s;
}

/** First run with slots: bring an old single save over as character 1 (a Warrior). */
export function migrateLegacySave() {
  for (let i = 0; i < SLOT_COUNT; i++) if (storage.read(slotKey(i))) return;
  for (const key of LEGACY_KEYS) {
    const raw = storage.read(key);
    if (!raw) continue;
    try {
      const s = migrate(JSON.parse(raw));
      s.name = 'Hero';
      s.job = 'warrior';
      writeSlot(0, s);
      if (key === 'idle-rpg-save-v2') storage.remove(key);
    } catch {
      /* ignore broken legacy saves */
    }
    return;
  }
}

/** Saves the character currently being played. */
export function saveGame(state: GameState) {
  state.lastSaved = Date.now();
  writeSlot(activeSlot, state);
}

export function exportSave(state: GameState): string {
  const json = JSON.stringify(state);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

export function importSave(code: string): GameState {
  const bytes = Uint8Array.from(atob(code.trim()), (c) => c.charCodeAt(0));
  return migrate(JSON.parse(new TextDecoder().decode(bytes)));
}
