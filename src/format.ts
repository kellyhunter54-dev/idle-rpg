const SUFFIX = ['', 'K', 'M', 'B', 'T'];

/** Formats big numbers: 1234 -> 1.23K, past T uses aa, ab, ac... */
export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  const tier = Math.floor(Math.log10(n) / 3);
  const scaled = n / Math.pow(1000, tier);
  let suf: string;
  if (tier < SUFFIX.length) suf = SUFFIX[tier];
  else {
    const i = tier - SUFFIX.length;
    suf = String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
  }
  const s = scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2);
  return s + suf;
}

export function fmtPct(x: number): string {
  return (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
}

export function fmtTime(sec: number): string {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
