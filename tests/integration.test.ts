import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, client } from "./harness";
import { templateGuide, type Interview } from "../src/lib/domain";
before(() => start(), { timeout: 90000 });
after(stop);
test(
  "text lifecycle: auth isolation, publication, branching, idempotent resume, capacity and preview separation",
  { timeout: 60000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      publicClient = await client();
    assert.equal((await owner("me")).status, 401);
    assert.equal(
      (
        await owner("auth/signup", "POST", {
          name: "Test Researcher",
          email: "owner@example.test",
          password: "temporary-test-password",
        })
      ).status,
      200,
    );
    await stranger("auth/signup", "POST", {
      name: "Other Researcher",
      email: "other@example.test",
      password: "temporary-test-password",
    });
    let study = (
      await owner("studies", "POST", { title: "Feedback decisions" })
    ).study;
    assert.equal((await stranger("studies/" + study.id)).status, 404);
    assert.equal((await publicClient("public/" + study.id)).status, 404);
    const g = templateGuide();
    g.limit = 1;
    g.questions = g.questions.slice(0, 3);
    g.questions[1].condition = { questionId: "screener", optionId: "yes" };
    study = (
      await owner("studies/" + study.id, "PUT", {
        guide: g,
        version: study.version,
      })
    ).study;
    assert.equal(
      (await owner("studies/" + study.id, "PUT", { guide: g, version: 1 }))
        .status,
      409,
    );
    study = (
      await owner("studies/" + study.id + "/publish", "POST", {
        version: study.version,
      })
    ).study;
    assert.equal(study.fielding, "paused");
    assert.equal(
      (await publicClient("public/" + study.id, "POST", { consent: true }))
        .status,
      409,
    );
    const preview = await owner("studies/" + study.id + "/preview", "POST");
    assert.equal(preview.interview.preview, true);
    study = (
      await owner("studies/" + study.id + "/fielding", "POST", {
        state: "active",
      })
    ).study;
    let r = await publicClient("public/" + study.id, "POST", { consent: true });
    assert.equal(r.status, 201);
    let interview: Interview = r.interview;
    const headers = { "x-interview-token": r.token };
    assert.equal(
      (await publicClient("interviews/" + interview.id)).status,
      404,
    );
    assert.equal(
      (await publicClient("public/" + study.id, "POST", { consent: true }))
        .status,
      409,
    );
    r = await publicClient(
      "interviews/" + interview.id + "/answer",
      "POST",
      {
        requestId: crypto.randomUUID(),
        version: 0,
        answer: "",
        optionId: "no",
      },
      headers,
    );
    assert.equal(r.interview.status, "screened_out");
    r = await publicClient("public/" + study.id, "POST", { consent: true });
    interview = r.interview;
    headers["x-interview-token"] = r.token;

    // Store a real one-second PCM WAV and verify access independently of the transcript.
    const wav = Buffer.alloc(44 + 16000 * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(32000, 40);
    const recordingId = crypto.randomUUID();
    const audioResponse = await fetch(
      "http://127.0.0.1:3101/api/interviews/" + interview.id + "/recording",
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "audio/wav",
          "x-recording-consent": "yes",
          "x-recording-id": recordingId,
          "x-recording-duration": "1000",
        },
        body: wav,
      },
    );
    assert.equal(audioResponse.status, 200);
    const audioId = (await audioResponse.json()).audioId;
    const retriedAudio = await fetch(
      "http://127.0.0.1:3101/api/interviews/" + interview.id + "/recording",
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "audio/wav",
          "x-recording-consent": "yes",
          "x-recording-duration": "1000",
          "x-recording-id": recordingId,
        },
        body: wav,
      },
    );
    const reused = await retriedAudio.json();
    assert.equal(reused.audioId, audioId);
    assert.equal(reused.reused, true);

    assert.equal((await publicClient("recordings/" + audioId)).status, 401);
    assert.equal((await stranger("recordings/" + audioId)).status, 404);
    assert.equal((await owner("recordings/" + audioId)).status, 200);
    const firstRevision = interview.revisionId;
    const answer = {
      requestId: crypto.randomUUID(),
      version: 0,
      answer: "",
      optionId: "yes",
      audioId,
      durationMs: 1000,
    };
    r = await publicClient(
      "interviews/" + interview.id + "/answer",
      "POST",
      answer,
      headers,
    );
    assert.equal(r.interview.current, 1);
    r = await publicClient(
      "interviews/" + interview.id + "/answer",
      "POST",
      answer,
      headers,
    );
    assert.equal(r.interview.turns.length, 1);
    g.questions[1].text = "Changed after publication";
    study = (
      await owner("studies/" + study.id, "PUT", {
        guide: g,
        version: study.version,
      })
    ).study;
    study = (
      await owner("studies/" + study.id + "/publish", "POST", {
        version: study.version,
      })
    ).study;
    r = await publicClient(
      "interviews/" + interview.id,
      "GET",
      undefined,
      headers,
    );
    assert.equal(r.interview.revisionId, firstRevision);
    assert.notEqual(r.interview.prompt, "Changed after publication");
    await owner("studies/" + study.id + "/fielding", "POST", {
      state: "closed",
    });
    assert.equal(
      (await publicClient("public/" + study.id, "POST", { consent: true }))
        .status,
      409,
    );
    interview = r.interview;
    while (interview.status === "active") {
      r = await publicClient(
        "interviews/" + interview.id + "/answer",
        "POST",
        {
          requestId: crypto.randomUUID(),
          version: interview.version,
          answer:
            "We compared several customer interviews before choosing which problem to fix next.",
        },
        headers,
      );
      assert.equal(r.status, 200);
      interview = r.interview;
    }
    assert.equal(interview.status, "complete");
    const d = await owner("studies/" + study.id);
    assert.equal(d.counts.complete, 1);
    assert.equal(d.counts.screenedOut, 1);
    assert.equal(d.interviews.length, 2);
    assert.equal(
      d.interviews.some((i: Interview) => i.preview),
      false,
    );
    assert.equal(
      (
        await owner(
          "studies/" + study.id + "/responses/" + interview.id,
          "PATCH",
          { excluded: true, reason: "" },
        )
      ).status,
      400,
    );
    await owner("studies/" + study.id + "/responses/" + interview.id, "PATCH", {
      excluded: true,
      reason: "Review fixture",
    });
    assert.equal((await owner("studies/" + study.id)).counts.included, 0);
    await owner("studies/" + study.id + "/responses/" + interview.id, "PATCH", {
      excluded: false,
      reason: "Restored",
    });
    assert.equal((await owner("studies/" + study.id)).counts.included, 1);
    assert.equal(
      (await owner("studies/" + study.id + "/draft", "POST")).status,
      503,
    );
    let analysis = (
      await owner("studies/" + study.id + "/analysis", "POST", {
        mode: "manual",
      })
    ).analysis;
    const source = interview.turns.find((t) => t.questionId === "decision")!;
    const theme = {
      id: "theme-a",
      title: "Evidence comparison",
      description: "The participant compared interviews.",
      citations: [
        { interviewId: interview.id, turnId: source.id, quote: source.answer },
      ],
    };
    assert.equal(
      (
        await owner("studies/" + study.id + "/analysis", "PUT", {
          id: analysis.id,
          version: analysis.version || 1,
          summary: "",
          limitations: "",
          themes: [
            {
              ...theme,
              citations: [{ ...theme.citations[0], quote: "Invented" }],
            },
          ],
        })
      ).status,
      502,
    );
    let saved = await owner("studies/" + study.id + "/analysis", "PUT", {
      id: analysis.id,
      version: analysis.version || 1,
      summary: "Researcher summary",
      limitations: "Small sample",
      themes: [theme],
      reviewed: true,
    });
    assert.equal(saved.stats.denominator, 1);
    assert.equal(saved.stats.themes[0].count, 1);
    analysis = saved.analysis;
    const shared = await owner("studies/" + study.id + "/share", "POST");
    assert.equal((await publicClient("shared/" + shared.token)).status, 200);
    await owner("studies/" + study.id + "/responses/" + interview.id, "PATCH", {
      excluded: true,
      reason: "Review sample",
    });
    assert.equal((await publicClient("shared/" + shared.token)).status, 404);
    assert.equal(
      (await owner("studies/" + study.id + "/analysis")).stale,
      true,
    );
    assert.equal(
      (await owner("studies/" + study.id + "/share", "POST")).status,
      409,
    );
    const exported = await owner("studies/" + study.id + "/export");
    assert.equal(exported.status, 200);
    assert.ok(exported.text.includes("participant_id"));
    assert.equal(
      (
        await owner(
          "studies/" + study.id + "/responses/" + interview.id,
          "DELETE",
        )
      ).deleted,
      true,
    );
    assert.equal((await owner("recordings/" + audioId)).status, 404);
    assert.equal(
      (
        await publicClient(
          "interviews/" + interview.id,
          "GET",
          undefined,
          headers,
        )
      ).status,
      404,
    );
    assert.equal(
      (await owner("studies/" + study.id + "/analysis")).analysis,
      null,
    );
    assert.equal((await publicClient("shared/" + shared.token)).status, 404);
  },
);
test(
  "collaborators can edit but not publish/launch; withdrawal releases admission capacity",
  { timeout: 30000 },
  async () => {
    const admin = await client(),
      collaborator = await client(),
      participant = await client();
    await admin("auth/signup", "POST", {
      name: "Team Admin",
      email: "admin@example.test",
      password: "temporary-test-password",
    });
    const invite = await admin("invites", "POST", { role: "collaborator" });
    const joined = await collaborator("auth/signup", "POST", {
      name: "Team Collaborator",
      email: "collaborator@example.test",
      password: "temporary-test-password",
      invite: invite.invite,
    });
    assert.equal(joined.user.role, "collaborator");
    let study = (
      await collaborator("studies", "POST", { title: "Shared research study" })
    ).study;
    assert.equal(
      (
        await collaborator("studies/" + study.id + "/publish", "POST", {
          version: study.version,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await collaborator("studies/" + study.id + "/fielding", "POST", {
          state: "active",
        })
      ).status,
      403,
    );
    const guide = study.draft;
    guide.limit = 1;
    study = (
      await admin("studies/" + study.id, "PUT", {
        guide,
        version: study.version,
      })
    ).study;
    study = (
      await admin("studies/" + study.id + "/publish", "POST", {
        version: study.version,
      })
    ).study;
    await admin("studies/" + study.id + "/fielding", "POST", {
      state: "active",
    });
    const started = await participant("public/" + study.id, "POST", {
      consent: true,
    });
    const h = { "x-interview-token": started.token };
    const stopped = await participant(
      "interviews/" + started.interview.id + "/stop",
      "POST",
      {},
      h,
    );
    assert.equal(stopped.interview.status, "withdrawn");
    assert.equal(stopped.interview.excluded, true);
    assert.equal(
      (
        await participant(
          "interviews/" + started.interview.id + "/answer",
          "POST",
          { requestId: crypto.randomUUID(), version: 1, answer: "No" },
          h,
        )
      ).status,
      409,
    );
    assert.equal(
      (await participant("public/" + study.id, "POST", { consent: true }))
        .status,
      201,
    );
  },
);
