"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import {
  quotaResolution,
  type QuotaSettings,
  type quotaProgress,
} from "@/lib/quotas";
type Data = {
  settings: QuotaSettings;
  progress: ReturnType<typeof quotaProgress>;
  canManage: boolean;
  screeners: {
    id: string;
    text: string;
    options: { id: string; text: string }[];
  }[];
  screening: number;
  quotaScreenOuts: number;
  totalLimit: number;
  configurationError: string | null;
  targetCapacity: { needed: number; remaining: number; feasible: boolean };
};
export default function QuotaPanel({ studyId }: { studyId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [settings, setSettings] = useState<QuotaSettings | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const path = "studies/" + studyId + "/quotas";
  async function load(isCurrent = () => true) {
    const d = await api<Data>(path);
    if (isCurrent()) {
      setData(d);
      setSettings(d.settings);
    }
  }
  useEffect(() => {
    let current = true;
    void load(() => current).catch((e) => {
      if (current) setError(e.message);
    });
    return () => {
      current = false;
    };
  }, [studyId]);
  function changeRule(
    index: number,
    patch: Partial<QuotaSettings["rules"][number]>,
  ) {
    setSettings(
      (s) =>
        s && {
          ...s,
          rules: s.rules.map((r, n) => (n === index ? { ...r, ...patch } : r)),
        },
    );
    setNotice("");
  }
  return (
    <section className="panel quota-panel">
      <h3>Participant quotas</h3>
      <p>
        Set participant targets by tags or screening answers. Qualified
        interviews reserve a place; completed interviews keep it.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data?.configurationError && (
        <p className="error" role="alert">
          Saved quotas need review: {data.configurationError}
        </p>
      )}
      {settings && data && (
        <>
          <p role="status">
            {data.screening} people screening · {data.quotaScreenOuts} quota
            screen-outs
          </p>
          {data.settings.enabled &&
            data.settings.rules.some(
              (r) => r.enabled && r.kind && r.kind !== "maximum",
            ) && (
              <p role="status">
                {data.targetCapacity.needed} places protected for minimum
                targets · Study limit {data.totalLimit}
                {!data.targetCapacity.feasible ? " · Targets need review" : ""}
              </p>
            )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await api(path, "PUT", {
                  version: settings.version,
                  enabled: settings.enabled,
                  requireMatch: settings.requireMatch,
                  rules: settings.rules,
                });
                await load();
                setNotice("Participant quotas saved.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="handoff-check">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={!data.canManage || busy}
                onChange={(e) =>
                  setSettings({ ...settings, enabled: e.target.checked })
                }
              />
              Enable participant quotas
            </label>
            <label className="handoff-check">
              <input
                type="checkbox"
                checked={settings.requireMatch}
                disabled={!data.canManage || busy}
                onChange={(e) =>
                  setSettings({ ...settings, requireMatch: e.target.checked })
                }
              />
              Only admit participants matching an enabled group
            </label>
            <p className="muted small">
              Counts start with new interviews admitted while quotas are
              enabled. Existing interviews are not reclassified. Normal study
              limits and invitation rules still apply.
            </p>
            {settings.rules.map((r, n) => {
              const progress = data.progress.find((p) => p.id === r.id),
                locked = !!progress?.linked,
                disabled = !data.canManage || busy,
                resolution = quotaResolution(r, data.totalLimit),
                count = resolution.count ?? 0;
              return (
                <fieldset key={r.id} className="quota-group">
                  <legend>Group {n + 1}</legend>
                  <label>
                    Group name
                    <input
                      aria-label={`Group ${n + 1} name`}
                      maxLength={100}
                      value={r.label}
                      disabled={disabled}
                      onChange={(e) => changeRule(n, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    Match using
                    <select
                      aria-label={`Group ${n + 1} match using`}
                      value={r.source || "tags"}
                      disabled={disabled || locked}
                      onChange={(e) =>
                        changeRule(n, {
                          source: e.target.value as "tags" | "screener",
                          conditions: [
                            {
                              key:
                                e.target.value === "screener" ? "" : "segment",
                              value: "",
                            },
                          ],
                        })
                      }
                    >
                      <option value="tags">Participant tags</option>
                      <option value="screener">Screening answers</option>
                    </select>
                  </label>
                  <label className="handoff-check">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      disabled={disabled}
                      onChange={(e) =>
                        changeRule(n, { enabled: e.target.checked })
                      }
                    />
                    Enable this group
                  </label>
                  <label>
                    Quota type
                    <select
                      aria-label={`Group ${n + 1} quota type`}
                      value={r.kind || "maximum"}
                      disabled={disabled}
                      onChange={(e) =>
                        changeRule(n, {
                          kind: e.target.value as
                            "maximum" | "minimum" | "exact",
                        })
                      }
                    >
                      <option value="maximum">Maximum</option>
                      <option value="minimum">Minimum</option>
                      <option value="exact">Exact</option>
                    </select>
                  </label>
                  <label>
                    Quota unit
                    <select
                      aria-label={`Group ${n + 1} quota unit`}
                      value={r.unit || "count"}
                      disabled={disabled}
                      onChange={(e) =>
                        changeRule(n, {
                          unit: e.target.value as "count" | "percent",
                        })
                      }
                    >
                      <option value="count">Participant count</option>
                      <option value="percent">Percentage</option>
                    </select>
                  </label>
                  <label>
                    {r.unit === "percent"
                      ? "Percentage of study limit"
                      : r.kind === "minimum" || r.kind === "exact"
                        ? "Target participants"
                        : "Maximum participants"}
                    <input
                      aria-label={
                        r.unit === "percent"
                          ? `Group ${n + 1} percentage`
                          : `Group ${n + 1} ${r.kind === "minimum" || r.kind === "exact" ? "target" : "maximum"} participants`
                      }
                      type="number"
                      min={r.unit === "percent" ? 0.01 : 1}
                      max={r.unit === "percent" ? 100 : 1000}
                      step={r.unit === "percent" ? 0.01 : 1}
                      required
                      value={r.limit}
                      disabled={disabled}
                      onChange={(e) =>
                        changeRule(n, { limit: Number(e.target.value) })
                      }
                    />
                  </label>
                  {r.unit === "percent" && (
                    <p
                      className={resolution.valid ? "small" : "error"}
                      role="status"
                    >
                      {resolution.valid
                        ? `${r.limit}% of published limit ${data.totalLimit} = ${count} participants`
                        : resolution.error}
                    </p>
                  )}
                  <p className="small">
                    {r.source === "screener"
                      ? "All selected answers must match. Places are reserved after the last screening question used by the enabled groups."
                      : "All tags below must match exactly, including capitalization."}
                  </p>
                  {r.conditions.map((c, m) => (
                    <div className="quota-condition" key={m}>
                      {r.source === "screener" ? (
                        <>
                          <label>
                            Screening question
                            <select
                              aria-label={`Group ${n + 1} screening question ${m + 1}`}
                              required
                              value={c.key}
                              disabled={disabled || locked}
                              onChange={(e) =>
                                changeRule(n, {
                                  conditions: r.conditions.map((v, j) =>
                                    j === m
                                      ? { key: e.target.value, value: "" }
                                      : v,
                                  ),
                                })
                              }
                            >
                              <option value="">
                                Choose a published question
                              </option>
                              {data.screeners.map((q) => (
                                <option key={q.id} value={q.id}>
                                  {q.text}
                                </option>
                              ))}
                              {locked &&
                                !data.screeners.some((q) => q.id === c.key) && (
                                  <option value={c.key}>
                                    Saved question ({c.key})
                                  </option>
                                )}
                            </select>
                          </label>
                          <label>
                            Qualifying answer
                            <select
                              aria-label={`Group ${n + 1} qualifying answer ${m + 1}`}
                              required
                              value={c.value}
                              disabled={disabled || locked}
                              onChange={(e) =>
                                changeRule(n, {
                                  conditions: r.conditions.map((v, j) =>
                                    j === m
                                      ? { ...v, value: e.target.value }
                                      : v,
                                  ),
                                })
                              }
                            >
                              <option value="">Choose an answer</option>
                              {data.screeners
                                .find((q) => q.id === c.key)
                                ?.options.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.text}
                                  </option>
                                ))}
                              {locked &&
                                !data.screeners
                                  .find((q) => q.id === c.key)
                                  ?.options.some((o) => o.id === c.value) && (
                                  <option value={c.value}>
                                    Saved answer ({c.value})
                                  </option>
                                )}
                            </select>
                          </label>
                        </>
                      ) : (
                        <>
                          {" "}
                          <label>
                            Tag name
                            <input
                              aria-label={`Group ${n + 1} tag ${m + 1} name`}
                              required
                              maxLength={64}
                              value={c.key}
                              disabled={disabled || locked}
                              onChange={(e) =>
                                changeRule(n, {
                                  conditions: r.conditions.map((v, j) =>
                                    j === m ? { ...v, key: e.target.value } : v,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Tag value
                            <input
                              aria-label={`Group ${n + 1} tag ${m + 1} value`}
                              required
                              maxLength={128}
                              value={c.value}
                              disabled={disabled || locked}
                              onChange={(e) =>
                                changeRule(n, {
                                  conditions: r.conditions.map((v, j) =>
                                    j === m
                                      ? { ...v, value: e.target.value }
                                      : v,
                                  ),
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                      {r.conditions.length > 1 && (
                        <button
                          type="button"
                          className="button"
                          disabled={disabled || locked}
                          onClick={() =>
                            changeRule(n, {
                              conditions: r.conditions.filter(
                                (_, j) => j !== m,
                              ),
                            })
                          }
                        >
                          {r.source === "screener"
                            ? "Remove condition"
                            : "Remove tag"}{" "}
                          {m + 1}
                        </button>
                      )}
                    </div>
                  ))}
                  {r.conditions.length < 4 && (
                    <button
                      type="button"
                      className="button"
                      disabled={disabled || locked}
                      onClick={() =>
                        changeRule(n, {
                          conditions: [...r.conditions, { key: "", value: "" }],
                        })
                      }
                    >
                      {r.source === "screener"
                        ? "Add screening condition"
                        : "Add matching tag"}
                    </button>
                  )}
                  {!resolution.valid ? (
                    <p className="quota-progress">
                      Effective count unavailable until corrected.
                    </p>
                  ) : (
                    <p className="quota-progress" role="status">
                      {progress?.complete || 0} completed ·{" "}
                      {progress?.active || 0} in progress ·{" "}
                      {Math.max(0, count - (progress?.reserved || 0))}
                      {r.kind === "minimum"
                        ? " more reservations needed"
                        : " places left"}
                      {r.kind !== "minimum" &&
                      resolution.valid &&
                      (progress?.reserved || 0) >= count
                        ? " · Full"
                        : ""}
                    </p>
                  )}
                  {resolution.valid &&
                    (r.kind === "minimum" || r.kind === "exact") && (
                      <p className="small">
                        {Math.max(0, count - (progress?.complete || 0))} more
                        completed interviews needed for the target. Active
                        reservations may still stop or screen out.
                      </p>
                    )}
                  {r.source === "screener" && (
                    <p className="small">
                      {progress?.screening || 0} candidates screening ·{" "}
                      {progress?.rejected || 0} full-group screen-outs ·{" "}
                      {progress?.protected || 0} target-protection screen-outs
                    </p>
                  )}
                  {locked && (
                    <p className="muted small">
                      This group has admitted interviews. Its matching rules
                      stay fixed; you can change the cap or disable the group.
                    </p>
                  )}
                  <button
                    type="button"
                    className="button danger"
                    disabled={disabled || locked}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        rules: settings.rules.filter((_, j) => j !== n),
                      })
                    }
                  >
                    Remove group {n + 1}
                  </button>
                </fieldset>
              );
            })}
            {data.canManage && (
              <div className="inline">
                <button
                  type="button"
                  className="button"
                  disabled={busy || settings.rules.length >= 20}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      rules: [
                        ...settings.rules,
                        {
                          id: crypto.randomUUID(),
                          label: "New group",
                          enabled: true,
                          limit: 10,
                          conditions: [{ key: "segment", value: "" }],
                        },
                      ],
                    })
                  }
                >
                  Add quota group
                </button>
                <button className="button primary" disabled={busy}>
                  Save participant quotas
                </button>
              </div>
            )}
            {!data.canManage && (
              <p className="muted">A researcher or admin can change quotas.</p>
            )}
          </form>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setError("");
              try {
                await load();
                setNotice("Quota progress refreshed.");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Refresh quota progress
          </button>
          <p className="small muted">
            Screening candidates hold places under the total study limit, but do
            not reserve a screener-group place until screening ends. Progress
            uses saved settings. Un-saved cap edits show an estimate until
            saved. Maximum-only groups can overlap; a participant must have
            space in every matching group. Minimum and exact targets require a
            disjoint partition. Stopped, screened-out and deleted interviews
            free their places. Excluding a completed response from analysis does
            not free its place.
          </p>
          <details>
            <summary>Set up screening and participant tags</summary>
            <p>
              For screening groups, publish a guide starting with single- or
              multiple-choice questions, then choose their qualifying answers
              above. Questions with branches, carry-forward or concept blocks
              are not available here. All referenced screening questions are
              answered before the quota check. Full or unmatched candidates
              receive a saved screen-out before the main interview.
            </p>
            <p>
              Use preset invitation tags, or participant-link query fields such
              as <code>?segment=customer</code>. Invitation tags take priority.
              URL tags are self-reported; use individual invitations when you
              need controlled group assignments. Quotas do not verify identity.
            </p>
            <p>
              Minimum targets preserve enough study places for the group. Exact
              targets also stop matching arrivals at the target. These controls
              protect capacity; they cannot supply participants or guarantee
              completions. Configure them before recruiting.
            </p>
            <p>
              Maximum counts support tags and leading choice screening answers.
              Minimum and exact targets require distinct groups from one tag or
              one single-choice question. Percentages use the published study
              limit: maximums round down, minimums round up, and exact
              percentages need a whole participant count. Draft limit changes
              have no effect. Automatic balancing is not included. Disabling a
              group leaves existing counts in place. Interviews admitted while
              quotas are disabled do not join groups later.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
