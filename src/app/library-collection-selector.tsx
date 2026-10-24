"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import {
  collectionLabels,
  type CollectionView,
} from "@/lib/library-collections";
import type { Language } from "@/lib/localization";
export default function CollectionSelector({
  value,
  onChange,
  language,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  language: Language;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<CollectionView[]>([]),
    [error, setError] = useState("");
  const l = collectionLabels[language];
  useEffect(() => {
    const c = new AbortController();
    void api<{ collections: CollectionView[] }>(
      "library/collections",
      "GET",
      undefined,
      undefined,
      c.signal,
    )
      .then((v) => {
        if (!c.signal.aborted) setRows(v.collections);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  return (
    <>
      <label>
        {l.scope}
        <select
          aria-label={l.scope}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{l.all}</option>
          {value && !rows.some((r) => r.id === value) && (
            <option value={value}>{l.missing}</option>
          )}
          {rows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.interviewIds.length})
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
