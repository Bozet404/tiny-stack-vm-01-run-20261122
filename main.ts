import { mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";

const STEP_LIMIT = 1000000;
const OUT_LIMIT = 65536;

function runInstance(prog, input) {
  const mem = new Int32Array(256);
  const stk = new Int32Array(257);
  const ret = new Int32Array(64);
  const out = Buffer.alloc(OUT_LIMIT);
  const n = prog.length;
  let sp = 0;
  let rp = 0;
  let pc = 0;
  let steps = 0;
  let inPos = 0;
  let outLen = 0;
  let code = -1;

  outer: while (true) {
    if (steps >= STEP_LIMIT) { code = 10; break; }
    if (pc < 0 || pc >= n) { code = 9; break; }
    const op = prog[pc];
    let next = pc + 1;
    let imm = 0;
    switch (op) {
      case 0x00: code = 0; break outer;
      case 0x01:
        if (pc + 1 >= n) { code = 9; break outer; }
        imm = prog[pc + 1];
        if (imm >= 128) imm -= 256;
        if (sp >= 256) { code = 3; break outer; }
        stk[sp++] = imm;
        next = pc + 2;
        break;
      case 0x02:
        if (pc + 4 >= n) { code = 9; break outer; }
        imm = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24);
        if (sp >= 256) { code = 3; break outer; }
        stk[sp++] = imm;
        next = pc + 5;
        break;
      case 0x03:
        if (sp < 1) { code = 2; break outer; }
        sp--;
        break;
      case 0x04:
        if (sp < 1) { code = 2; break outer; }
        if (sp >= 256) { code = 3; break outer; }
        stk[sp] = stk[sp - 1];
        sp++;
        break;
      case 0x05:
        if (sp < 2) { code = 2; break outer; }
        imm = stk[sp - 1];
        stk[sp - 1] = stk[sp - 2];
        stk[sp - 2] = imm;
        break;
      case 0x06:
        if (sp < 2) { code = 2; break outer; }
        if (sp >= 256) { code = 3; break outer; }
        stk[sp] = stk[sp - 2];
        sp++;
        break;
      case 0x07:
        if (sp < 3) { code = 2; break outer; }
        imm = stk[sp - 3];
        stk[sp - 3] = stk[sp - 2];
        stk[sp - 2] = stk[sp - 1];
        stk[sp - 1] = imm;
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14:
      case 0x15: case 0x16: case 0x18: case 0x19: case 0x1a:
      case 0x1c: case 0x1d: case 0x1e: case 0x20: case 0x21: case 0x22: {
        if (sp < 2) { code = 2; break outer; }
        const a = stk[sp - 2];
        const b = stk[sp - 1];
        sp -= 2;
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) { code = 4; break outer; }
          r = (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) { code = 4; break outer; }
          r = (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) { code = 4; break outer; }
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) { code = 4; break outer; }
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        stk[sp++] = r;
        break;
      }
      case 0x17:
        if (sp < 1) { code = 2; break outer; }
        stk[sp - 1] = (-stk[sp - 1]) | 0;
        break;
      case 0x1b:
        if (sp < 1) { code = 2; break outer; }
        stk[sp - 1] = ~stk[sp - 1];
        break;
      case 0x30:
        if (pc + 2 >= n) { code = 9; break outer; }
        imm = prog[pc + 1] | (prog[pc + 2] << 8);
        if (imm >= 32768) imm -= 65536;
        next = pc + 3 + imm;
        break;
      case 0x31: case 0x32:
        if (pc + 2 >= n) { code = 9; break outer; }
        if (sp < 1) { code = 2; break outer; }
        imm = prog[pc + 1] | (prog[pc + 2] << 8);
        if (imm >= 32768) imm -= 65536;
        next = pc + 3;
        if ((op === 0x31 && stk[--sp] === 0) || (op === 0x32 && stk[--sp] !== 0)) next = pc + 3 + imm;
        break;
      case 0x33:
        if (pc + 2 >= n) { code = 9; break outer; }
        if (rp >= 64) { code = 7; break outer; }
        imm = prog[pc + 1] | (prog[pc + 2] << 8);
        ret[rp++] = pc + 3;
        next = imm;
        break;
      case 0x34:
        if (rp === 0) { code = 8; break outer; }
        next = ret[--rp];
        break;
      case 0x40:
        if (sp < 1) { code = 2; break outer; }
        imm = stk[sp - 1];
        if (imm < 0 || imm > 255) { code = 6; break outer; }
        stk[sp - 1] = mem[imm];
        break;
      case 0x41:
        if (sp < 2) { code = 2; break outer; }
        imm = stk[sp - 1];
        if (imm < 0 || imm > 255) { code = 6; break outer; }
        mem[imm] = stk[sp - 2];
        sp -= 2;
        break;
      case 0x50: {
        if (sp < 1) { code = 2; break outer; }
        const s = String(stk[--sp]);
        if (outLen + s.length > OUT_LIMIT) { code = 11; break outer; }
        out.write(s, outLen, "ascii");
        outLen += s.length;
        break;
      }
      case 0x51:
        if (sp < 1) { code = 2; break outer; }
        if (outLen + 1 > OUT_LIMIT) { code = 11; break outer; }
        out[outLen++] = stk[--sp] & 255;
        break;
      case 0x52:
        if (sp >= 256) { code = 3; break outer; }
        stk[sp++] = inPos < input.length ? input[inPos++] : -1;
        break;
      case 0x53:
        if (sp < 1) { code = 2; break outer; }
        code = stk[--sp] & 255;
        break outer;
      default:
        code = 5;
        break outer;
    }
    steps++;
    pc = next;
  }
  return { out: out.subarray(0, outLen), code };
}

try {
  mkdirSync("/output", { recursive: true });
} catch {
  mkdirSync(readlinkSync("/output"), { recursive: true });
}

const ids = readdirSync("/input").sort();
for (const id of ids) {
  let prog;
  let input;
  try {
    prog = readFileSync("/input/" + id + "/program.bin");
    input = readFileSync("/input/" + id + "/input.bin");
  } catch {
    continue;
  }
  const { out, code } = runInstance(prog, input);
  mkdirSync("/output/" + id, { recursive: true });
  writeFileSync("/output/" + id + "/stdout.bin", out);
  writeFileSync("/output/" + id + "/exit.txt", String(code) + "\n");
}
