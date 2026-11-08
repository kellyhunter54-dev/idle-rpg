// Small pixel sprites for the run mode (pickups, chests, shrines, projectiles). Original art.
import { RGB, fromRows, hexRgb } from '../pixel';

const O: RGB = [27, 20, 16];
const cache = new Map<string, HTMLCanvasElement>();
const cached = (key: string, make: () => HTMLCanvasElement) => {
  let c = cache.get(key);
  if (!c) {
    c = make();
    cache.set(key, c);
  }
  return c;
};
const shade = (h: string, t: number): RGB => {
  const c = hexRgb(h);
  return t < 0 ? [c[0] * (1 + t), c[1] * (1 + t), c[2] * (1 + t)] : [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t];
};

/** EXP gem, colour by value. Anchor: bottom centre. */
export function gem(color: string): HTMLCanvasElement {
  return cached('gem' + color, () =>
    fromRows(['..o..', '.oLo.', 'oLMDo', 'oMMDo', '.oDo.', '..o..'], { o: O, L: shade(color, 0.55), M: hexRgb(color), D: shade(color, -0.35) }),
  );
}
export function gemColor(v: number): string {
  return v < 2 ? '#6ce0ff' : v < 8 ? '#6ccf5a' : v < 30 ? '#ff6b9b' : '#ffd166';
}

export function coin(): HTMLCanvasElement {
  return cached('coin', () => fromRows(['.ooo.', 'oYGYo', 'oGYDo', 'oYDDo', '.ooo.'], { o: O, G: hexRgb('#fff1a8'), Y: hexRgb('#e0b84a'), D: hexRgb('#9a7420') }));
}
export function heart(): HTMLCanvasElement {
  return cached('heart', () => fromRows(['.oo.oo.', 'oLRoRRo', 'oRRRRDo', '.oRRDo.', '..oDo..', '...o...'], { o: O, L: hexRgb('#ffb3b3'), R: hexRgb('#e04848'), D: hexRgb('#8f2020') }));
}
export function magnet(): HTMLCanvasElement {
  return cached('magnet', () => fromRows(['oooooo', 'oRooBo', 'oRooBo', 'oRRBBo', '.oRBo.', '..oo..'], { o: O, R: hexRgb('#e04848'), B: hexRgb('#4ea1ff') }));
}

/** Treasure chest. Anchor: bottom centre. */
export function chest(open: boolean, gold: boolean): HTMLCanvasElement {
  return cached(`chest${open}${gold}`, () => {
    const wood = gold ? '#c9a227' : '#8b5a2b';
    const band = gold ? '#fff1a8' : '#c9a227';
    const rows = open
      ? ['..............', '.oooooooooooo.', 'oDDDDDDDDDDDDo', 'oYYYYYYYYYYYYo', 'oooooooooooooo', 'oWWWWWBBWWWWWo', 'oWWWWWBBWWWWWo', 'oDWWWWWWWWWWDo', 'oDDDDDDDDDDDDo', 'oooooooooooooo']
      : ['..oooooooooo..', '.oLLLLBBLLLLo.', 'oLWWWWBBWWWWWo', 'oWWWWWBBWWWWDo', 'ooooooYYoooooo', 'oWWWWWYYWWWWWo', 'oWWWWWBBWWWWWo', 'oDWWWWWWWWWWDo', 'oDDDDDDDDDDDDo', 'oooooooooooooo'];
    return fromRows(rows, { o: O, W: hexRgb(wood), L: shade(wood, 0.3), D: shade(wood, -0.35), B: hexRgb(band), Y: hexRgb('#fff8d6') });
  });
}

/** Shrine pillar with a glowing gem on top. Anchor: bottom centre. */
export function shrine(used: boolean, frame: number): HTMLCanvasElement {
  return cached(`shrine${used}${frame}`, () => {
    const glow = used ? '#5d5a66' : frame ? '#8fd3ff' : '#c7ecff';
    const rows = [
      '...oo...', '..oGGo..', '.oGLGGo.', '..oGGo..', '...oo...', '..oooo..', '.oSSSSo.', '..oSso..', '..oSso..', '..oSso..', '..oSso..', '..oSso..', '.oSSSso.', 'oSSSSSso', 'oooooooo',
    ];
    return fromRows(rows, { o: O, G: hexRgb(glow), L: shade(glow, 0.6), S: hexRgb('#9a958a'), s: hexRgb('#6b665c') });
  });
}

export function axe(): HTMLCanvasElement {
  return cached('axe', () =>
    fromRows(['...oooo..', '..oLLMMo.', '.oLMMMDo.', '.oMMooo..', '..oobo...', '...obo...', '...obo...', '...obo...', '....o....'], {
      o: O, L: hexRgb('#ffffff'), M: hexRgb('#cfd8e3'), D: hexRgb('#8a96a3'), b: hexRgb('#8b5a2b'),
    }),
  );
}
export function blade(): HTMLCanvasElement {
  return cached('blade', () => fromRows(['..o..', '.oLo.', 'oLMDo', '.oDo.', '..o..'], { o: O, L: hexRgb('#ffffff'), M: hexRgb('#cfd8e3'), D: hexRgb('#7d8794') }));
}
export function bolt(): HTMLCanvasElement {
  return cached('bolt', () => fromRows(['.ooo.', 'oYOOo', 'oOORo', 'oORRo', '.ooo.'], { o: hexRgb('#5a1e0c'), Y: hexRgb('#fff1a8'), O: hexRgb('#ff8c42'), R: hexRgb('#d9480f') }));
}
export function orb(color: string): HTMLCanvasElement {
  return cached('orb' + color, () => fromRows(['.ooo.', 'oLMMo', 'oMMDo', 'oMDDo', '.ooo.'], { o: O, L: shade(color, 0.6), M: hexRgb(color), D: shade(color, -0.4) }));
}

/** Wall torch: iron bracket and a flickering flame (4 frames). Anchor: bracket bottom centre. */
export function torch(frame: number): HTMLCanvasElement {
  return cached('torch' + frame, () => {
    const flames = [
      ['..y..', '.yYy.', '.YWY.', 'yYWYy', '.yOy.'],
      ['.y...', '.yYy.', 'yYWY.', '.YWYy', '.yOy.'],
      ['...y.', '.yYy.', '.YWYy', 'yYWY.', '.yOy.'],
      ['..y..', '..Yy.', '.yWY.', '.YWYy', '.yOy.'],
    ][frame & 3];
    return fromRows([...flames, '.oOo.', '.oBo.', '..B..', '.oBo.', '..o..'], {
      o: O, y: hexRgb('#ff9a3c'), Y: hexRgb('#ffd166'), W: hexRgb('#fff8d6'), O: hexRgb('#d9480f'), B: hexRgb('#4a3a2c'),
    });
  });
}
