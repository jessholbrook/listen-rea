import { clearInvitationEmails } from "./invitation-email-cleanup";
import { db, get, put, now, transaction } from "./db";
import type { Interview } from "./domain";
import { redactInvitation, type ParticipantInvitation } from "./recruitment";
export async function clearResponseInvitation(i: Interview) {
  if (!i.invitationId) return;
  const v = await get<ParticipantInvitation>(
    "participantInvitation",
    i.invitationId,
    i.workspaceId,
  );
  if (!v || v.studyId !== i.studyId || v.interviewId !== i.id) return;
  await clearInvitationEmails(v);
  const at = now(),
    clean = redactInvitation(v, at);
  clean.interviewId = undefined;
  clean.responseDeletedAt = at;
  await put("participantInvitation", clean);
}
export async function invitationRetention(cutoff: number) {
  const rows = await db
    .prepare(
      "SELECT kind,id,workspace_id,data FROM documents WHERE kind IN ('participantInvitation','invitationBatch') AND json_extract(data,'$.createdAt')<?",
    )
    .all(new Date(cutoff).toISOString());
  await transaction(async () => {
    for (const row of rows) {
      // Reread under the write transaction: a link may have been claimed meanwhile.
      const kind = row.kind as string;
      const current = await get<ParticipantInvitation>(
        kind,
        row.id as string,
        row.workspace_id as string,
      );
      if (!current) continue;
      const i = current.interviewId
        ? await get<Interview>(
            "interview",
            current.interviewId,
            current.workspaceId,
          )
        : undefined;
      if (kind === "participantInvitation")
        await clearInvitationEmails(current);
      if (kind === "participantInvitation" && i) {
        if (!current.redactedAt)
          await put(kind, redactInvitation(current, now()));
      } else
        await db
          .prepare(
            "DELETE FROM documents WHERE kind=? AND id=? AND workspace_id=?",
          )
          .run(kind, current.id, current.workspaceId);
    }
  });
}
