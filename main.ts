// Tiny stack VM — make.fun tiny-stack-vm-01-run-20261122.
// Runs /input/<id>/program.bin + input.bin, writes /output/<id>/stdout.bin
// and exit.txt. 32-bit wrapping values, 256-slot data stack, 64-deep call
// stack, 256 memory words, 1,000,000 steps, 65,536 output bytes, ten traps
// each with its own exit code; output written before a trap is kept. Checks
// run in ISA order: step limit, pc, unknown opcode, cut-off immediate,
// underflow, overflow, then the opcode's own trap.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per opcode: [immediate bytes, values popped, values pushed].
const SPEC: [number, number, number][] = [];
for (const [o, i, p, q] of [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1], [0x20, 0, 2, 1],
  [0x21, 0, 2, 1], [0x22, 0, 2, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1],
  [0x41, 0, 2, 0], [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1],
  [0x53, 0, 1, 0],
]) SPEC[o] = [i, p, q];

// Two-operand op; null only for division by zero (trap 4).
function bin(op: number, a: number, b: number): number | null {
  switch (op) {
    case 0x10: return (a + b) | 0;
    case 0x11: return (a - b) | 0;
    case 0x12: return Math.imul(a, b);
    case 0x13:
      if (b === 0) return null;
      return a === -2147483648 && b === -1 ? a : (a / b) | 0;
    case 0x14:
      if (b === 0) return null;
      return b === -1 ? 0 : (a % b) | 0;
    case 0x15:
      if (b === 0) return null;
      return Math.floor((a >>> 0) / (b >>> 0)) | 0;
    case 0x16:
      if (b === 0) return null;
      return ((a >>> 0) % (b >>> 0)) | 0;
    case 0x18: return a & b;
    case 0x19: return a | b;
    case 0x1a: return a ^ b;
    case 0x1c: return a << (b & 31);
    case 0x1d: return a >> (b & 31);
    case 0x1e: return (a >>> (b & 31)) | 0;
    case 0x20: return a === b ? 1 : 0;
    case 0x21: return a < b ? 1 : 0;
    default: return (a >>> 0) < (b >>> 0) ? 1 : 0; // 0x22 LTU
  }
}

function run(prog: Uint8Array, input: Uint8Array): { out: Uint8Array; code: number } {
  const n = prog.length;
  const st = new Int32Array(256);
  let sp = 0;
  const cs = new Int32Array(64);
  let cp = 0;
  const mem = new Int32Array(256);
  const out = new Uint8Array(65536);
  let olen = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const enc = new TextEncoder();
  const done = (code: number) => ({ out: out.slice(0, olen), code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = prog[pc];
    const s = SPEC[op];
    if (s === undefined) return done(5);
    if (pc + s[0] >= n) return done(9);
    steps++;
    const nx = pc + 1 + s[0];
    if (sp < s[1]) return done(2);
    if (sp - s[1] + s[2] > 256) return done(3);
    pc = nx;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: st[sp++] = (prog[nx - 1] << 24) >> 24; break;
      case 0x02:
        st[sp++] = prog[nx - 4] | (prog[nx - 3] << 8) | (prog[nx - 2] << 16) | (prog[nx - 1] << 24);
        break;
      case 0x03: sp--; break;
      case 0x04: st[sp] = st[sp - 1]; sp++; break;
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; }
      case 0x06: st[sp] = st[sp - 2]; sp++; break;
      case 0x07: {
        const a = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = a;
        break;
      }
      case 0x17: st[sp - 1] = -st[sp - 1] | 0; break;
      case 0x1b: st[sp - 1] = ~st[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = st[sp - 1];
        const a = st[sp - 2];
        const r = bin(op, a, b);
        if (r === null) return done(4);
        sp -= 2;
        st[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[nx - 2] | (prog[nx - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          const v = st[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return done(7);
        cs[cp++] = nx;
        pc = prog[nx - 2] | (prog[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return done(8);
        pc = cs[--cp];
        break;
      case 0x40: {
        const addr = st[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        st[sp - 1] = mem[addr];
        break;
      }
      case 0x41: {
        const addr = st[sp - 1];
        const v = st[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2;
        mem[addr] = v;
        break;
      }
      case 0x50: {
        const bytes = enc.encode(String(st[sp - 1]));
        if (olen + bytes.length > 65536) return done(11);
        sp--;
        out.set(bytes, olen);
        olen += bytes.length;
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return done(11);
        out[olen++] = st[--sp] & 255;
        break;
      case 0x52: st[sp++] = ip < input.length ? input[ip++] : -1; break;
      case 0x53: return done(st[--sp] & 255);
      default: return done(5);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(
    new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))),
  );
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
