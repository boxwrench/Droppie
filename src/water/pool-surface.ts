/**
 * Adapted from ScottieFox/caustic-volume, CAUSTIC//LITE stepRipples and hull.
 * Upstream d87351bff19831aa9d11c0679605fad6797b133f, MIT.
 * See LICENSES/caustic-volume-MIT.txt and THIRD_PARTY_NOTICES.md.
 *
 * The reference's two-height wave stencil, Gaussian impulses and old/new hull
 * displacement are retained. Here units are metres, the boundary is circular,
 * and a small CPU grid feeds the existing WebGPU renderer through one texture.
 */
export class PoolSurface {
  readonly size = 80;
  readonly pixels = new Float32Array(this.size * this.size * 4);
  readonly radius: number;
  readonly limit: number;
  revision = 0;
  maxHeight = 0;
  energy = 0;
  private current = new Float32Array(this.size * this.size);
  private previous = new Float32Array(this.size * this.size);
  private readonly inside = new Uint8Array(this.size * this.size);
  private readonly neighbors = new Int32Array(this.size * this.size * 4);
  private readonly drops: {x: number; z: number; radius: number; height: number}[] = [];
  private readonly hull = {x: 0, z: 0, radius: .03, depth: 0};
  private readonly oldHull = {...this.hull};
  private accumulator = 0;
  private moving = false;

  constructor(radius: number, depth: number) {
    this.radius = radius; this.limit = depth * .43;
    const n = this.size;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1, z = j / (n - 1) * 2 - 1;
      this.inside[j * n + i] = x * x + z * z <= 1 ? 1 : 0;
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      for (const [side, ni, nj] of [[0, i - 1, j], [1, i + 1, j], [2, i, j - 1], [3, i, j + 1]]) {
        const neighbor = nj * n + ni;
        this.neighbors[k * 4 + side] = ni >= 0 && ni < n && nj >= 0 && nj < n && this.inside[neighbor] ? neighbor : k;
      }
    }
    this.writeTexture();
  }

  get active() { return this.moving || this.drops.length > 0; }
  get queuedImpulses() { return this.drops.length; }

  setHull(x: number, z: number, radius: number, depth: number) {
    Object.assign(this.hull, {x, z, radius, depth});
  }

  disturb(x: number, z: number, strength: number, radius = .017) {
    if (Math.hypot(x, z) >= this.radius) return;
    if (this.drops.length === 8) this.drops.shift();
    this.drops.push({x, z, radius, height: Math.max(0, Math.min(1, strength)) * .0045});
  }

  reset() {
    this.current.fill(0); this.previous.fill(0); this.drops.length = 0;
    this.accumulator = 0; this.moving = false; this.maxHeight = 0; this.energy = 0;
    Object.assign(this.oldHull, this.hull);
    this.writeTexture();
  }

  private hullAt(x: number, z: number, hull: typeof this.hull) {
    const qx = (x - hull.x) / hull.radius, qz = (z - hull.z) / hull.radius;
    const r = Math.max(0, 1 - qx * qx - qz * qz);
    return hull.depth * r * r;
  }

  step(dt: number) {
    this.accumulator += dt;
    while (this.accumulator + 1e-10 >= 1 / 60) {
      this.accumulator -= 1 / 60;
      const moved = (this.hull.depth > 0 || this.oldHull.depth > 0) &&
        (Math.hypot(this.hull.x - this.oldHull.x, this.hull.z - this.oldHull.z) > .00001 ||
        Math.abs(this.hull.depth - this.oldHull.depth) > .000002 || Math.abs(this.hull.radius - this.oldHull.radius) > .00001);
      if (!this.active && !moved) { Object.assign(this.oldHull, this.hull); continue; }
      const n = this.size, cell = 2 * this.radius / (n - 1);
      for (const drop of this.drops) {
        const minX = Math.max(0, Math.floor((drop.x - 3 * drop.radius + this.radius) / cell));
        const maxX = Math.min(n - 1, Math.ceil((drop.x + 3 * drop.radius + this.radius) / cell));
        const minZ = Math.max(0, Math.floor((drop.z - 3 * drop.radius + this.radius) / cell));
        const maxZ = Math.min(n - 1, Math.ceil((drop.z + 3 * drop.radius + this.radius) / cell));
        for (let j = minZ; j <= maxZ; j++) for (let i = minX; i <= maxX; i++) {
          const k = j * n + i;
          if (!this.inside[k]) continue;
          const x = i * cell - this.radius - drop.x, z = j * cell - this.radius - drop.z;
          this.current[k] += drop.height * Math.exp(-(x * x + z * z) / (drop.radius * drop.radius));
        }
      }
      this.drops.length = 0;
      let maximum = 0, energy = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (!this.inside[k]) continue;
        const q = k * 4, neighbors = this.neighbors;
        const sum = this.current[neighbors[q]] + this.current[neighbors[q + 1]] + this.current[neighbors[q + 2]] + this.current[neighbors[q + 3]];
        const x = i * cell - this.radius, z = j * cell - this.radius;
        const hull = this.hullAt(x, z, this.hull);
        // Same neighbour/previous-height update and hull difference as Lite.
        const next = ((sum * .5 - this.previous[k]) * .985 + .42 * (this.hullAt(x, z, this.oldHull) - hull)) *
          (1 - .15 * hull / Math.max(.0001, this.hull.depth));
        this.previous[k] = Math.max(-this.limit, Math.min(this.limit, next));
        maximum = Math.max(maximum, Math.abs(this.previous[k]), Math.abs(this.current[k]));
        energy += this.previous[k] ** 2 + (this.previous[k] - this.current[k]) ** 2;
      }
      [this.current, this.previous] = [this.previous, this.current];
      Object.assign(this.oldHull, this.hull);
      this.maxHeight = maximum; this.energy = energy;
      this.moving = maximum > .000008;
      if (!this.moving) { this.current.fill(0); this.previous.fill(0); this.maxHeight = 0; this.energy = 0; }
      this.writeTexture();
    }
  }

  private writeTexture() {
    const inverseCell = (this.size - 1) / (4 * this.radius);
    for (let k = 0; k < this.current.length; k++) {
      const p = k * 4, neighbors = this.neighbors;
      this.pixels[p] = this.current[k];
      this.pixels[p + 1] = (this.current[neighbors[p + 1]] - this.current[neighbors[p]]) * inverseCell;
      this.pixels[p + 2] = (this.current[neighbors[p + 3]] - this.current[neighbors[p + 2]]) * inverseCell;
      this.pixels[p + 3] = this.inside[k];
    }
    this.revision++;
  }
}
