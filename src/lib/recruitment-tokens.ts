import { createHmac } from "node:crypto";
export function invitationToken(
  secret: string,
  workspaceId: string,
  studyId: string,
  requestId: string,
  index: number,
) {
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(JSON.stringify([workspaceId, studyId, requestId, index]))
    .digest("base64url");
}
