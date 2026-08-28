/**
 * The header's note button — a round speech-bubble icon that appends a coach's note
 * to whichever point is currently being captured (see capture-flow.ts's ADD_NOTE).
 *
 * Voice-first where the browser can transcribe live: tap to start, the button turns
 * from blue to the recording color while listening, tap again to stop and the
 * transcript is added as the note. Where the browser has no SpeechRecognition (no
 * Firefox, and some cloud-backed Chromium builds fail outright with no connectivity —
 * this is capture, which has to work offline mid-match) the same tap opens a bottom
 * sheet with a text field instead, matching this screen's other quick-input sheets
 * (unusual-point-sheet.tsx). A recognition error lands there too, transcript so far
 * pre-filled, rather than leaving the coach stuck on a dead button.
 */

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { NOTE_MAX_LENGTH } from "./point";

// Not yet in TypeScript's DOM lib. Only the shape this component actually uses,
// same narrow-cast approach as navigator.standalone in lib/device-platform.ts rather
// than a project-wide ambient declaration for an API used in exactly one place.
interface MinimalSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

// One recording session, in a ref rather than closure variables the handlers alone
// can see: a tap has to reach the transcript, because a session the service already
// ended is committed by that tap while a live one is committed by its own `onend`.
interface NoteSession {
  recognition: MinimalSpeechRecognition;
  transcript: string;
  failed: boolean;
  ended: boolean;
  stopping: boolean;
  /** Adds what was heard as the note. Every caller clears the ref first, so it runs once. */
  commit: () => void;
  /** The coach's stop, and unmount: commits an already-ended session, stops a live one. */
  finish: () => void;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function NoteButton({ onAddNote }: { onAddNote: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const sessionRef = useRef<NoteSession | null>(null);
  // The caller rebuilds this prop every render over that render's own capture state, so
  // committing through the one captured when recording started would roll the flow back
  // to the moment the mic was tapped, losing the points captured while dictating.
  const onAddNoteRef = useRef(onAddNote);
  useEffect(() => {
    onAddNoteRef.current = onAddNote;
  });

  // Stop a still-running recognition if the coach navigates away mid-point (e.g. a
  // skip-ahead) rather than leaving the mic listening behind an unmounted button.
  // What it heard is still added, on the same two branches as the coach's own stop.
  useEffect(() => {
    return () => {
      sessionRef.current?.finish();
    };
  }, []);

  function openTextEntry() {
    setDraftText("");
    setSheetOpen(true);
  }

  function startRecording() {
    const Ctor = getSpeechRecognitionCtor();
    if (Ctor === null) {
      openTextEntry();
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = false;
      const session: NoteSession = {
        recognition,
        transcript: "",
        failed: false,
        ended: false,
        stopping: false,
        commit: () => {
          // An errored session's transcript is already sitting in the sheet, and
          // appendNote joins with a newline: adding it here too is one note, twice.
          if (session.failed) return;
          const text = session.transcript.trim();
          if (text.length > 0) onAddNoteRef.current(text);
        },
        finish: () => {
          // Per spec, stop() on a session the service already ended does nothing and
          // fires no `end`, so nothing more is coming and the commit belongs here.
          if (session.ended) {
            sessionRef.current = null;
            setRecording(false);
            session.commit();
            return;
          }
          // A live session still owes a final result, delivered between stop() and
          // `end`, so its commit waits for onend rather than reading a short transcript.
          session.stopping = true;
          recognition.stop();
        },
      };
      recognition.onresult = (event) => {
        // Capped here as well as on the textarea: the field's maxLength bounds typing,
        // not a value set from script, and a long dictation arrives in one go.
        session.transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript ?? "")
          .join(" ")
          .slice(0, NOTE_MAX_LENGTH);
      };
      recognition.onerror = () => {
        // Denied mic, no speech heard, or (some Chromium builds) no connectivity to
        // reach the recognition service — fall back to typing instead of a dead end.
        // Guarded, or a superseded session's late `aborted` opens the sheet over a
        // live mic, pre-filled with a note the coach already added.
        if (sessionRef.current !== session) return;
        session.failed = true;
        setRecording(false);
        setDraftText(session.transcript.trim());
        setSheetOpen(true);
      };
      recognition.onend = () => {
        if (sessionRef.current !== session) return;
        if (session.stopping) {
          // The coach's stop: the final result the service owed has arrived by now,
          // so this is where the note is whole and the button leaves the recording colour.
          sessionRef.current = null;
          setRecording(false);
          session.commit();
          return;
        }
        // `continuous` doesn't stop the service ending a session itself, on silence in
        // Chrome and a short pause on iOS. The mic really is off from here while the
        // button still reads as recording; the next tap commits what was heard.
        session.ended = true;
      };
      sessionRef.current = session;
      setRecording(true);
      recognition.start();
    } catch {
      // iOS Safari throws from the constructor when the speech service is unavailable
      // and Chrome from start(); either would otherwise leave the button in the
      // recording colour with no tap left that reaches the sheet.
      sessionRef.current = null;
      setRecording(false);
      openTextEntry();
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="icon"
        aria-label={recording ? "Stop recording note" : "Add a note"}
        aria-pressed={recording}
        onClick={() => {
          if (recording) {
            sessionRef.current?.finish();
            return;
          }
          if (getSpeechRecognitionCtor() !== null) {
            startRecording();
          } else {
            openTextEntry();
          }
        }}
        className={cn(
          "rounded-full",
          recording && "bg-recording text-recording-foreground hover:bg-recording/90",
        )}
      >
        <MessageCircle className="size-5" />
      </Button>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
        }}
      >
        <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
          <SheetHeader className="p-0">
            <SheetTitle>Add a note</SheetTitle>
          </SheetHeader>
          <Textarea
            autoFocus
            value={draftText}
            onChange={(event) => {
              setDraftText(event.target.value);
            }}
            placeholder="What happened?"
            maxLength={NOTE_MAX_LENGTH}
            className="min-h-24"
          />
          <div className="grid grid-cols-[1fr_1.4fr] gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSheetOpen(false);
              }}
              className="h-14 text-base"
            >
              Cancel
            </Button>
            <Button
              disabled={draftText.trim().length === 0}
              onClick={() => {
                onAddNote(draftText.trim());
                setSheetOpen(false);
              }}
              className="h-14 text-base"
            >
              Add note
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
