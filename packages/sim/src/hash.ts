// FNV-1a 32 bit over typed array bytes. Used for sim.hash() checkpoints and divergence reports.

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

export class Fnv {
  h = OFFSET;

  bytes(view: ArrayBufferView): this {
    const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let h = this.h;
    for (let i = 0; i < u8.length; i++) {
      h ^= u8[i];
      h = Math.imul(h, PRIME);
    }
    this.h = h;
    return this;
  }

  u32(v: number): this {
    let h = this.h;
    for (let k = 0; k < 4; k++) {
      h ^= (v >>> (k * 8)) & 0xff;
      h = Math.imul(h, PRIME);
    }
    this.h = h;
    return this;
  }

  /** Hash a float64 by its exact bit pattern. */
  f64(v: number): this {
    F64[0] = v;
    return this.bytes(F64);
  }

  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, "0");
  }
}

const F64 = new Float64Array(1);
