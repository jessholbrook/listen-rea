import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
const glyphs: Record<string, string> = {
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01111/10000/10000/10000/10000/10000/01111",
  D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01111/10000/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  I: "11111/00100/00100/00100/00100/00100/11111",
  J: "00111/00010/00010/00010/10010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/11001/10101/10011/10001/10001/10001",
  O: "01110/10001/10001/10001/10001/10001/01110",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/10101/01010",
  X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111",
};
function screen(support: boolean) {
  const width = 640,
    height = 360,
    pixels = Buffer.alloc(width * height * 3);
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: number[],
  ) => {
    for (let j = y; j < Math.min(height, y + h); j++)
      for (let i = x; i < Math.min(width, x + w); i++) {
        const at = (j * width + i) * 3;
        pixels[at] = color[0];
        pixels[at + 1] = color[1];
        pixels[at + 2] = color[2];
      }
  };
  const text = (
    s: string,
    x: number,
    y: number,
    scale: number,
    color: number[],
  ) => {
    for (const [n, c] of [...s].entries())
      for (const [row, line] of (glyphs[c] || "0/0/0/0/0/0/0")
        .split("/")
        .entries())
        for (const [col, bit] of [...line].entries())
          if (bit === "1")
            rect(
              x + n * 6 * scale + col * scale,
              y + row * scale,
              scale,
              scale,
              color,
            );
  };
  const color = support ? [35, 88, 67] : [37, 60, 115];
  rect(0, 0, width, height, [245, 247, 250]);
  rect(0, 0, width, 110, color);
  text(support ? "SUPPORT" : "HOME", 30, 30, 7, [255, 255, 255]);
  text(support ? "SUPPORT PAGE" : "CHOOSE HELP", 30, 150, 5, [20, 25, 30]);
  rect(30, 240, 280, 80, color);
  text(support ? "CONTACT" : "HELP", 50, 260, 5, [255, 255, 255]);
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}
export function visualFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "echo-visual-fixture-"));
  try {
    writeFileSync(path.join(dir, "home.ppm"), screen(false));
    writeFileSync(path.join(dir, "support.ppm"), screen(true));
    const out = path.join(dir, "fixture.mp4");
    execFileSync(ffmpeg!, [
      "-v",
      "error",
      "-loop",
      "1",
      "-framerate",
      "12",
      "-i",
      path.join(dir, "home.ppm"),
      "-loop",
      "1",
      "-framerate",
      "12",
      "-i",
      path.join(dir, "support.ppm"),
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=24000",
      "-filter_complex",
      "[0:v]trim=duration=1.5,setpts=PTS-STARTPTS[a];[1:v]trim=duration=2.5,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-map",
      "2:a",
      "-t",
      "4",
      "-r",
      "12",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      out,
    ]);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
