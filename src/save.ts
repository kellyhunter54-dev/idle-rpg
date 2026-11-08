import { GameState, migrate, newState } from './state';

/**
 * All saving goes through this interface. In the browser it uses localStorage.
 * For a desktop build (Tauri) swap in a file-based implementation here and
 * nothing else in the game needs to change.
 */
export interface SaveStorage {
  read(): string | null;
  write(data: string): void;
  clear(): void;
}

const KEY = 'idle-rpg-save-v1';

export const localSaveStorage: SaveStorage = {
  read() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write(data) {
    try {
      localStorage.setItem(KEY, data);
    } catch {
      /* storage full or blocked; ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

let storage: SaveStorage = localSaveStorage;
export function setSaveStorage(s: SaveStorage) {
  storage = s;
}

export function saveGame(state: GameState) {
  state.lastSaved = Date.now();
  storage.write(JSON.stringify(state));
}

export function loadGame(): GameState {
  const raw = storage.read();
  if (!raw) return newState();
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return newState();
  }
}

export function clearSave() {
  storage.clear();
}

export function exportSave(state: GameState): string {
  const json = JSON.stringify(state);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

export function importSave(code: string): GameState {
  const bytes = Uint8Array.from(atob(code.trim()), (c) => c.charCodeAt(0));
  return migrate(JSON.parse(new TextDecoder().decode(bytes)));
}
