import { db } from "./db";
import type { Interview } from "./domain";
export async function clearResponseIncentives(i: Interview) {
  await db
    .prepare(
      "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND kind IN ('incentiveRecord','incentiveRequest','tremendousOrder') AND json_extract(data,'$.interviewId')=?",
    )
    .run(i.workspaceId, i.studyId, i.id);
}
