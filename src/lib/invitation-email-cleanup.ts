import { db } from "./db";
export async function clearInvitationEmails(v: {
  id: string;
  workspaceId: string;
}) {
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='invitationEmail' AND workspace_id=? AND json_extract(data,'$.invitationId')=?",
    )
    .run(v.workspaceId, v.id);
}
export async function emailRetention(cutoff: number) {
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='invitationEmail' AND json_extract(data,'$.createdAt')<?",
    )
    .run(new Date(cutoff).toISOString());
}
