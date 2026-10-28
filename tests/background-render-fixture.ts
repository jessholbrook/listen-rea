import assert from "node:assert/strict";
import { recordingSetup } from "./library-recordings-fixture";
export async function backgroundRenderSetup() {
  const c = await recordingSetup();
  let r = await c.upload((await c.create()).recording);
  r = await c.transcribe(r);
  const sourcePath = "library/recordings/" + r.id;
  r = (
    await c.owner(sourcePath, "PUT", {
      version: r.version,
      text: r.original.text,
      reviewed: true,
    })
  ).recording;
  const approved = await c.owner(sourcePath + "/approve", "POST", {
    version: r.version,
    reviewed: true,
  });
  assert.equal(approved.status, 200);
  const source = (await c.owner("library/sources/" + approved.interviewId))
    .source;
  const path = `studies/${c.s.id}/reporting`;
  const clip = await c.owner(path + "/clips", "POST", {
    name: "Synthetic background clip",
    mediaId: source.media[0].id,
    quote: source.turns[0].answer,
    startMs: 0,
    endMs: 1000,
    caption: "Synthetic reviewed caption",
    reviewed: true,
  });
  assert.equal(clip.status, 201, JSON.stringify(clip));
  const reel = await c.owner(path + "/reels", "POST", {
    name: "Synthetic background reel",
    clipIds: [clip.clip.id],
    reviewed: true,
  });
  assert.equal(reel.status, 201, JSON.stringify(reel));
  const rendered = await c.owner(path + "/jobs", "POST", {
    reelId: reel.reel.id,
    version: reel.reel.version,
  });
  assert.equal(rendered.status, 201);
  return {
    ...c,
    path,
    clip: clip.clip,
    reel: reel.reel,
    render: rendered.job,
    interviewId: approved.interviewId,
  };
}
