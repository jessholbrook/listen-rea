"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Language } from "@/lib/localization";
import { unifiedLabels, type PlanningRow } from "@/lib/unified-planning";
import { deadlineLabels } from "@/lib/review-deadlines";
import { inboxLabels } from "@/lib/team-review-inbox";
import type { ReviewPlanning } from "@/lib/review-workload";
import { planDate } from "@/lib/review-plans";
type Preview = {
  planning: Pick<
    ReviewPlanning,
    "id" | "packetVersion" | "version" | "signature" | "title"
  >;
  name: string;
  before: string | null;
  after: string | null;
  approved: boolean;
};
export default function ReviewDeadlinePlanner({
  row,
  language,
  onFinish,
}: {
  row: Extract<PlanningRow, { kind: "review" }>;
  language: Language;
  onFinish: () => void;
}) {
  const l = unifiedLabels[language],
    d = deadlineLabels[language],
    il = inboxLabels[language];
  const [date, setDate] = useState(row.dueDate || ""),
    [clear, setClear] = useState(!row.dueDate),
    [preview, setPreview] = useState<Preview | null>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function prepare() {
    setBusy(true);
    try {
      const after = clear ? null : planDate.parse(date);
      const { planning: p } = await api<{ planning: ReviewPlanning }>(
        `library/collections/${row.collectionId}/handoff/planning?id=${row.packet.id}`,
      );
      const reviewer = p.reviewers.find((r) => r.id === row.reviewer.id);
      if (!reviewer?.available) throw Error(l.unavailable);
      if (alive.current) {
        setPreview({
          planning: {
            id: p.id,
            packetVersion: p.packetVersion,
            version: p.version,
            signature: p.signature,
            title: p.title,
          },
          name: reviewer.name || il.unavailableReviewer,
          before: reviewer.dueDate || null,
          after,
          approved: !!reviewer.approvedAt,
        });
        setAck(false);
      }
    } catch {
      if (alive.current) setError(l.unavailable);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function apply() {
    if (!preview || !ack) return;
    setBusy(true);
    try {
      const { title: _, ...coordinates } = preview.planning;
      await api(
        `library/collections/${row.collectionId}/handoff/feedback`,
        "POST",
        {
          ...coordinates,
          op: "deadline",
          reviewerId: row.reviewer.id,
          dueDate: preview.after,
        },
      );
      if (alive.current) setSaved(true);
    } catch {
      if (alive.current) {
        setPreview(null);
        setAck(false);
        setError(l.failed);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="panel library-stack"
      aria-label={l.schedule}
      aria-busy={busy}
    >
      <h3>{l.schedule}</h3>
      <strong>{preview?.planning.title || row.title}</strong>
      <p>{preview?.name || row.personName || il.unavailableReviewer}</p>
      <p>{l.reviewWarning}</p>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{l.saved}</p>}
      {!preview && !error && !saved && (
        <form
          className="library-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void prepare();
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={clear}
              disabled={busy}
              onChange={(e) => setClear(e.target.checked)}
            />
            {l.clear}
          </label>
          <label>
            {d.due}
            <input
              aria-label={d.due}
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={date}
              required={!clear}
              disabled={busy || clear}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            className="button"
            disabled={busy || (!clear && !date)}
            type="submit"
          >
            {l.preview}
          </button>
        </form>
      )}
      {preview && !saved && (
        <>
          <p>{preview.approved ? il.approved : il.pending}</p>
          <p>
            {l.before}: {preview.before || d.none}
          </p>
          <p>
            {l.after}: {preview.after || d.none}
          </p>
          <label>
            <input
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />
            {l.ack}
          </label>
          <button
            className="button"
            disabled={busy || !ack}
            onClick={() => void apply()}
          >
            {l.apply}
          </button>
        </>
      )}
      <button className="button" disabled={busy} onClick={onFinish}>
        {saved || error ? l.finish : l.cancel}
      </button>
    </section>
  );
}
