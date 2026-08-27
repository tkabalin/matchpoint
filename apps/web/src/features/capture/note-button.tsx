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
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);

  // Stop a still-running recognition if the coach navigates away mid-point (e.g. a
  // skip-ahead) rather than leaving the mic listening behind an unmounted button.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
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
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    let transcript = "";
    recognition.onresult = (event) => {
      // Capped here as well as on the textarea: the field's maxLength bounds typing,
      // not a value set from script, and a long dictation arrives in one go.
      transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .slice(0, NOTE_MAX_LENGTH);
    };
    recognition.onerror = () => {
      // Denied mic, no speech heard, or (some Chromium builds) no connectivity to
      // reach the recognition service — fall back to typing instead of a dead end.
      recognitionRef.current = null;
      setRecording(false);
      setDraftText(transcript.trim());
      setSheetOpen(true);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setRecording(false);
      const text = transcript.trim();
      if (text.length > 0) onAddNote(text);
    };
    recognitionRef.current = recognition;
    setRecording(true);
    recognition.start();
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
            recognitionRef.current?.stop();
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
