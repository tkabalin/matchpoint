/**
 * The header's note button — a round speech-bubble icon that appends a coach's note
 * to whichever point is currently being captured (see capture-flow.ts's ADD_NOTE).
 *
 * Voice-first where the browser can transcribe live: tap to start, the button turns
 * from blue to the recording color while listening, tap again to stop and the
 * transcript is added as the note. Press-and-hold instead opens a bottom sheet with a
 * text field, matching this screen's other quick-input sheets (unusual-point-sheet.tsx)
 * and the tap/hold split the skip button next to it already has: a coach on a noisy
 * court, or within earshot of the opponent, should not have to talk to their phone.
 *
 * That sheet has three ways in, because typing is the route that needs no microphone,
 * no permission and no network: the hold; the visually hidden button beside this one,
 * since a keyboard or switch activation dispatches a click with no pointerdown and so
 * can never hold; and a plain tap where dictating is impossible at all, meaning no
 * SpeechRecognition (no Firefox, and some cloud-backed Chromium builds fail outright
 * with no connectivity, while capture has to work offline mid-match) or a recognition
 * error, transcript so far pre-filled.
 */

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { NOTE_MAX_LENGTH } from "./point";
import { usePressAndHold } from "./use-press-and-hold";

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
  const { holdHandlers, consumeHold } = usePressAndHold();
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
        {...holdHandlers}
        onContextMenu={(event) => {
          // A touch long-press dispatches contextmenu, and left un-prevented it cancels
          // the touch sequence before its click. Unlike skip's handler this calls
          // nothing: the click it keeps alive is what opens the sheet.
          event.preventDefault();
        }}
        onClick={() => {
          // Read before the recording branch, or a hold that stopped a recording would
          // leave the flag set for the next activation to open the sheet with.
          const held = consumeHold();
          if (recording) {
            sessionRef.current?.finish();
            return;
          }
          if (held) {
            openTextEntry();
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

      {/* A keyboard or switch activation dispatches a click with no pointerdown, so it
          can never hold: without this there is no route to the typed sheet for anyone
          who can't perform the gesture. Out of the header's flow until it has focus. */}
      <button
        type="button"
        onClick={openTextEntry}
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-sm focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-ring"
      >
        Type a note instead
      </button>

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
