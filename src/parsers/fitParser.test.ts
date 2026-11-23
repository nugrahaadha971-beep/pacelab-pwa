import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFit } from './fitParser.ts';

const T0 = 1_100_000_000; // timestamp FIT (detik sejak 1989-12-31)

/** Berkas FIT sintetis: record (definisi lokal 0), record terkompresi, session (lokal 1). */
function buildFit(): ArrayBuffer {
  const b: number[] = [];
  const u8 = (...xs: number[]) => { b.push(...xs); };
  const u16 = (v: number) => { b.push(v & 255, (v >>> 8) & 255); };
  const u32 = (v: number) => { b.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); };

  u8(0x40, 0, 0); u16(20); u8(3, 253, 4, 0x86, 5, 4, 0x86, 3, 1, 0x02);
  u8(0x00); u32(T0); u32(0); u8(140);
  u8(0x00); u32(T0 + 300); u32(100000); u8(150);
  u8(0x80 | ((T0 + 305) & 0x1f)); u32(200000); u8(160);

  u8(0x41, 0, 0); u16(18); u8(6, 2, 4, 0x86, 8, 4, 0x86, 9, 4, 0x86, 16, 1, 0x02, 17, 1, 0x02, 22, 2, 0x84);
  u8(0x01); u32(T0); u32(305000); u32(200000); u8(150, 160); u16(25);

  const n = b.length;
  const hdr = [14, 16, 0, 0, n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255, 0x2e, 0x46, 0x49, 0x54, 0, 0];
  return new Uint8Array([...hdr, ...b, 0, 0]).buffer;
}

test('FIT: jarak, durasi, HR, elevasi dari session', () => {
  const r = parseFit(buildFit());
  assert.equal(r.source, 'fit');
  assert.equal(r.distanceKm, 2);
  assert.equal(r.durationSec, 305);
  assert.equal(r.avgHr, 150);
  assert.equal(r.maxHr, 160);
  assert.equal(r.elevationGain, 25);
  assert.equal(r.date, (T0 + 631065600) * 1000);
});

test('FIT: split per km dari record', () => {
  assert.equal(parseFit(buildFit()).laps[0].paceSec, 300);
});

test('FIT: tolak berkas bukan FIT', () => {
  assert.throws(() => parseFit(new ArrayBuffer(20)), /Bukan berkas FIT/);
});
