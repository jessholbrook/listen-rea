export function toneWav(ms = 3000) {
  const rate = 16000,
    count = Math.round((rate * ms) / 1000),
    b = Buffer.alloc(44 + count * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(count * 2, 40);
  for (let n = 0; n < count; n++)
    b.writeInt16LE(
      Math.round(Math.sin((n / rate) * 440 * Math.PI * 2) * 4000),
      44 + n * 2,
    );
  return b;
}
