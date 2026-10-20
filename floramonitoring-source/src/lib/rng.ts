// Small, fast, seeded random number generators for reproducible Monte Carlo.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private u: () => number;
  private spare: number | null = null;
  constructor(seed = 12345) {
    this.u = mulberry32(seed);
  }
  uniform() {
    return this.u();
  }
  /** Standard normal (Marsaglia polar method). */
  normal() {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let x = 0;
    let y = 0;
    let s = 0;
    do {
      x = this.u() * 2 - 1;
      y = this.u() * 2 - 1;
      s = x * x + y * y;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = y * m;
    return x * m;
  }
  /** Gamma(k, 1) via Marsaglia & Tsang. */
  gamma(k: number): number {
    if (k < 1) return this.gamma(k + 1) * Math.pow(this.u(), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x = 0;
      let v = 0;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.u();
      if (u < 1 - 0.0331 * x ** 4) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  beta(a: number, b: number) {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x / (x + y);
  }
  int(n: number) {
    return Math.floor(this.u() * n);
  }
}
