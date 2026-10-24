// Invitation context stays in the URL fragment, not the request URL or tags.
// Separate saved sessions prevent a new link on a shared browser resuming a
// different invitation's interview.
export async function invitationSessionKey(
  studyId: string,
  invitation: string | null,
) {
  if (!invitation) return "study-session:" + studyId;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(invitation),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `study-session:${studyId}:${fingerprint}`;
}
