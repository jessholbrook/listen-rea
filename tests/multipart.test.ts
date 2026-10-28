import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetch, Request } from "undici";
import { transcriptionBody } from "../src/lib/speech";

test("transcription upload preserves model and file bytes across the HTTP multipart boundary", async () => {
  const received: { model?: unknown; filename?: string; bytes?: number[] } = {};
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const parsed = await new Request("http://localhost/upload", {
        method: "POST",
        headers: { "content-type": req.headers["content-type"]! },
        body: Buffer.concat(chunks),
      }).formData();
      received.model = parsed.get("model");
      const file = parsed.get("file");
      assert.ok(file && typeof file !== "string");
      received.filename = file.name;
      received.bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      res.end("ok");
    } catch {
      res.statusCode = 400;
      res.end("invalid multipart");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/upload`, {
      method: "POST",
      body: transcriptionBody(
        new Uint8Array([1, 2, 3, 4]),
        "audio/wav",
        "recording.wav",
        "gpt-4o-mini-transcribe",
      ),
    });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(received.model, "gpt-4o-mini-transcribe");
    assert.equal(received.filename, "recording.wav");
    assert.deepEqual(received.bytes, [1, 2, 3, 4]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
