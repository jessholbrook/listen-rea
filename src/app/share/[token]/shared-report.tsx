"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Brand, Notice, Spinner } from "../../components";
import { ShieldCheck } from "lucide-react";
export default function SharedReport({ token }: { token: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("shared/" + token)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <div className="participant-shell">
      <header>
        <Brand />
        <span className="private-label">
          <ShieldCheck size={14} /> View-only report
        </span>
      </header>
      <main className="participant-main">
        {error ? (
          <Notice>{error}</Notice>
        ) : !data ? (
          <Spinner />
        ) : (
          <>
            <div className="eyebrow">REVIEWED BY THE STUDY TEAM</div>
            <h1>{data.title}</h1>
            {data.kind === "reel" && (
              <>
                <video
                  className="shared-reel"
                  controls
                  src={"/api/shared/" + token + "/media"}
                />
                <a
                  className="button"
                  href={"/api/shared/" + token + "/captions"}
                >
                  Download captions
                </a>
              </>
            )}
            {data.kind === "edition" && (
              <a className="button" href={"/api/shared/" + token + "/deck"}>
                Download editable PowerPoint
              </a>
            )}
            <div className="memo" style={{ marginTop: 35 }}>
              {data.memo}
            </div>
          </>
        )}
      </main>
      <footer>
        <Brand />
        <span>Shared research · view only</span>
      </footer>
    </div>
  );
}
