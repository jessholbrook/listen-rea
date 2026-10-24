// A fixed vector label avoids dependence on system fonts in hosted renderers.
export const watermarkVersion = "echo-confidential-v1";
const glyphs: Record<string, string[]> = {
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
};
export function watermarkSvg(width: number, height: number) {
  const text = "ECHO LAB CONFIDENTIAL",
    labelWidth = text.length * 6 - 1;
  const scale = Math.min(
    width / (labelWidth + 12),
    Math.max(0.25, (width / (labelWidth + 12)) * 0.82),
    height / 36,
  );
  let path = "";
  [...text].forEach((letter, n) =>
    glyphs[letter]?.forEach((row, y) =>
      [...row].forEach((pixel, x) => {
        if (pixel === "1") path += `M${n * 6 + x} ${y}h1v1h-1z`;
      }),
    ),
  );
  const w = labelWidth * scale,
    h = 7 * scale;
  const positions = [
    [Math.max(2, width * 0.04), Math.max(2, height * 0.15)],
    [Math.max(2, (width - w) / 2), Math.max(2, (height - h) / 2)],
    [Math.max(2, width - w - width * 0.04), Math.max(2, height * 0.85 - h)],
  ];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${positions.map(([x, y]) => `<g transform="translate(${x} ${y}) scale(${scale})"><rect x="-3" y="-3" width="${labelWidth + 6}" height="13" rx="1" fill="black" opacity=".18"/><path d="${path}" fill="white" opacity=".48"/></g>`).join("")}</svg>`,
  );
}
