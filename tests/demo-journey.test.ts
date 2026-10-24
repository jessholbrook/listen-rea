import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
import {
  initialUnifiedFilters,
  planningRows,
} from "../src/lib/unified-planning";

test(
  "one original interview travels through findings, handoff and planning; erasure revokes derived work",
  { timeout: 120000 },
  async () => {
    try {
      await start({ port: 3430 });
      const owner = await client(),
        participant = await client();
      assert.equal(
        (
          await owner("auth/signup", "POST", {
            name: "Synthetic demo researcher",
            email: "demo-journey@example.test",
            password: "synthetic-demo-password",
          })
        ).status,
        200,
      );
      let s = (
        await owner("studies", "POST", { title: "Synthetic demo journey" })
      ).study;
      s.draft.questions = [{ ...s.draft.questions[1], followUps: 0 }];
      s = (
        await owner("studies/" + s.id, "PUT", {
          guide: s.draft,
          version: s.version,
        })
      ).study;
      s = (
        await owner("studies/" + s.id + "/publish", "POST", {
          version: s.version,
        })
      ).study;
      await owner("studies/" + s.id + "/fielding", "POST", { state: "active" });
      const joined = await participant("public/" + s.id, "POST", {
        consent: true,
      });
      assert.equal(joined.status, 201);
      const answer =
        "We searched three tools before finding the original customer quote.";
      const completed = await participant(
        "interviews/" + joined.interview.id + "/answer",
        "POST",
        {
          requestId: randomUUID(),
          version: joined.interview.version,
          answer,
        },
        { "x-interview-token": joined.token },
      );
      assert.equal(completed.status, 200);
      const interview = completed.interview;
      assert.equal(interview.status, "complete");
      const root = "studies/" + s.id;
      let analysis = (
        await owner(root + "/analysis", "POST", { mode: "manual" })
      ).analysis;
      const summary =
        "This synthetic participant searched several tools to retrieve one source.";
      const reviewed = await owner(root + "/analysis", "PUT", {
        ...analysis,
        summary,
        reviewed: true,
        themes: [
          {
            id: "retrieval",
            title: "Scattered evidence",
            description: summary,
            citations: [
              {
                interviewId: interview.id,
                turnId: interview.turns[0].id,
                quote: answer,
              },
            ],
          },
        ],
      });
      assert.equal(reviewed.status, 200);
      analysis = reviewed.analysis;
      assert.equal(analysis.reviewed, true);
      assert.ok((await owner(root + "/export")).text.includes(answer));
      const collection = (
        await owner("library/collections", "POST", {
          requestId: randomUUID(),
          title: "Synthetic demo follow-through",
          interviewIds: [interview.id],
          briefIds: [],
        })
      ).collection;
      const task = (
        await owner(`library/collections/${collection.id}/tasks`, "POST", {
          requestId: randomUUID(),
          title: "Investigate source retrieval",
          assigneeId: null,
          status: "open",
          dueDate: "2028-02-29",
          target: { kind: "interview", id: interview.id },
        })
      ).task;
      const handoff = `library/collections/${collection.id}/handoff`;
      let packet = await owner(handoff, "POST", {
        requestId: randomUUID(),
        title: "Synthetic research handoff",
        summary: analysis.summary,
        language: "en",
        answerIds: [],
        taskIds: [task.id],
      });
      assert.equal(packet.status, 201);
      packet = await owner(handoff + "/review", "POST", {
        id: packet.packet.id,
        version: packet.packet.version,
        signature: packet.signature,
        reviewed: true,
      });
      assert.equal(packet.packet.canExport, true);
      const packetURL =
        handoff +
        "/export?" +
        new URLSearchParams({
          id: packet.packet.id,
          version: String(packet.packet.version),
          signature: packet.signature,
          format: "md",
        });
      const handedOff = await owner(packetURL);
      assert.equal(handedOff.status, 200);
      assert.ok(handedOff.text.includes(summary));
      assert.ok(handedOff.text.includes(task.id));
      const config = {
        kind: "unified",
        language: "en",
        timeZone: "America/Los_Angeles",
        filters: {
          ...initialUnifiedFilters("2028-02-29"),
          collectionId: collection.id,
        },
      };
      const planning = await owner("library/unified-planning");
      assert.deepEqual(
        planningRows(planning, config.filters, "2028-02-29", true).map(
          (r) => r.key,
        ),
        ["task:" + task.id],
      );
      const reportRoot = "library/operations-report/";
      const preview = await owner(reportRoot + "preview", "POST", { config });
      assert.equal(preview.rows.length, 1);
      const exportInput = {
        config,
        signature: preview.signature,
        reviewed: true,
        format: "csv",
      };
      const file = await owner(reportRoot + "export", "POST", exportInput);
      assert.equal(file.status, 200);
      assert.ok(file.text.includes(task.id));
      assert.equal(
        (await owner(root + "/responses/" + interview.id, "DELETE")).status,
        200,
      );
      assert.equal((await owner(root + "/analysis")).analysis, null);
      assert.equal((await owner(packetURL)).status, 404);
      assert.equal(
        (await owner(reportRoot + "export", "POST", exportInput)).status,
        409,
      );
      assert.equal(
        (await owner(reportRoot + "preview", "POST", { config })).rows.length,
        0,
      );
      assert.deepEqual(
        planningRows(
          await owner("library/unified-planning"),
          config.filters,
          "2028-02-29",
          true,
        ),
        [],
      );
    } finally {
      await stop();
    }
  },
);
