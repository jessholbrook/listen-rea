"use client";
import { useState } from "react";
import VoiceInput from "./voice-input";
import StreamingVoice from "./streaming-voice";
import { richerCopy } from "@/lib/richer-copy";
export default function VoiceModes(
  props: React.ComponentProps<typeof VoiceInput>,
) {
  const [mode, setMode] = useState("recorded"),
    [childBusy, setChildBusy] = useState(false),
    c = richerCopy(props.language);
  function onBusy(value: boolean) {
    setChildBusy(value);
    props.onBusy(value);
  }
  return (
    <div className="visual-stack">
      {props.provider && (
        <label>
          {c.voiceMode}
          <select
            aria-label={c.voiceMode}
            value={mode}
            disabled={childBusy}
            onChange={(e) => {
              localStorage.setItem("voice-mode:" + props.interviewId, "false");
              props.onAudio(null);
              props.onBusy(false);
              setMode(e.target.value);
            }}
          >
            <option value="recorded">{c.recorded}</option>
            <option value="streaming">{c.streaming}</option>
          </select>
        </label>
      )}
      {mode === "streaming" && props.provider ? (
        <StreamingVoice
          key={props.version}
          language={props.language || "en"}
          interviewId={props.interviewId}
          token={props.token}
          version={props.version}
          prompt={props.prompt}
          onTranscript={props.onTranscript}
          onBusy={onBusy}
        />
      ) : (
        <VoiceInput key={props.version} {...props} onBusy={onBusy} />
      )}
    </div>
  );
}
