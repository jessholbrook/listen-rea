import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  distDir: process.env.RESEARCH_BUILD_DIR || ".next",
  // Bundle PptxGenJS: its ESM export uses .js without declaring type=module.
  serverExternalPackages: ["undici", "ffmpeg-static", "pdf-lib"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./assets/DejaVuSans.ttf",
      "./assets/validate-pdf.cjs",
      "./assets/prepare-docx.cjs",
      "./assets/prepare-pptx.cjs",
      "./node_modules/yauzl/**/*",
      "./node_modules/pend/**/*",
      "./node_modules/buffer-crc32/**/*",
      "./node_modules/saxes/**/*",
      "./node_modules/xmlchars/**/*",
      "./assets/extract-pdf-text.mjs",
      "./assets/render-pdf-page.mjs",
      "./node_modules/pdfjs-dist/legacy/build/*.mjs",
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/pdf-lib/**/*",
      "./node_modules/@pdf-lib/**/*",
      "./node_modules/pako/**/*",
      "./node_modules/tslib/**/*",
    ],
  },
  // Local Vercel builds must not trace private local state or downloaded test fixtures.
  outputFileTracingExcludes: {
    "/*": [
      "./.data/**/*",
      "./.env*",
      "./test-results/**/*",
      "./tests/**/*",
      "./.vercel/**/*",
    ],
  },
  experimental: { cpus: 2 },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self)" },
        ],
      },
      {
        source: "/oauth/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/s/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};
export default config;
