/**
 * The header's note button — a round speech-bubble icon that appends a coach's note
 * to whichever point is currently being captured (see capture-flow.ts's ADD_NOTE).
 *
 * Voice-first where the browser can transcribe live: tap to start, and a panel drops
 * down from the header with a text field that fills in as the coach speaks, plus the
 * Cancel and Save pair that ends it. The button itself becomes that same Save, since a
 * thumb already on it shouldn't have to travel. The field stays plain-text editable
 * throughout, so a coach can correct a mis-heard word and have their edit, not the raw
 * transcript, become the note. That panel is a plain absolutely-positioned block
 * anchored under `MatchHeader` (its `relative` root), not the shared `Sheet`: a modal
 * sheet disables pointer interaction with everything outside it, which would make the
 * very button that has to end the recording untappable while it's up.
 *
 * Press-and-hold instead opens the shared `Sheet` straight into typing, no mic
 * involved — from the top of the screen, not the bottom, where a coach's keyboard would
 * cover the field — matching the tap/hold split the skip button next to it already has:
 * a coach on a noisy court, or within earshot of the opponent, should not have to talk
 * to their phone. That sheet has no reachability problem of its own: nothing outside it
 * needs a tap while it's open, since Cancel and Save are both inside it.
 *
 * That typed-first route exists for three reasons, since typing needs no microphone, no
 * permission and no network: the hold; the visually hidden button beside this one,
 * since a keyboard or switch activation dispatches a click with no pointerdown and so
 * can never hold; and a plain tap where dictating is impossible at all, meaning no
 * SpeechRecognition (no Firefox, and some cloud-backed Chromium builds fail outright
 * with no connectivity, while capture has to work offline mid-match) or a recognition
 * error, transcript so far pre-filled and left for the coach to save or cancel by hand.
 */

import { MessageCircle, Save } from "lucide-react";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { hasSeenHoldTip, markHoldTipSeen } from "@/lib/hold-tip";
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

// "stopped" is the mic ending the session itself, which it does on silence in Chrome
// and a short pause on iOS: the panel and its buttons stay, but nothing is being
// transcribed, so the recording colour would be a lie.
type NotePhase = "idle" | "listening" | "stopped";

// One recording session, in a ref rather than closure variables the handlers alone
// can see: a tap has to reach the transcript, because a session the service already
// ended is committed by that tap while a live one is committed by its own `onend`.
interface NoteSession {
  recognition: MinimalSpeechRecognition;
  transcript: string;
  ended: boolean;
  stopping: boolean;
  /** Adds what's in the field as the note. Every caller clears the ref first, so it runs once. */
  commit: () => void;
  /** Save, and unmount: commits an already-ended session, stops a live one. */
  finish: () => void;
  /** Ends the session committing nothing: Cancel, a recognition error, a point boundary. */
  abandon: () => void;
}

export interface NoteHandle {
  /** Hands over what's been dictated so far and ends the session, leaving the panel up. */
  takePending: () => string;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function NoteButton({
  onAddNote,
  ref,
}: {
  onAddNote: (text: string) => void;
  ref?: Ref<NoteHandle>;
}) {
  const [phase, setPhase] = useState<NotePhase>("idle");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const sessionRef = useRef<NoteSession | null>(null);
  // Mirrors draftText for commit() to read synchronously: a ref update lands before the
  // next render, where the state alone might not yet reflect the field's latest value.
  const draftTextRef = useRef("");
  // Set the moment the coach types into the field, so a live transcript stops
  // overwriting a correction they've already made — their edit wins until the next
  // recording session resets it.
  const editedRef = useRef(false);
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
  // What it heard is still added, on the same two branches as the coach's own Save.
  useEffect(() => {
    return () => {
      sessionRef.current?.finish();
    };
  }, []);

  function setDraft(text: string) {
    draftTextRef.current = text;
    setDraftText(text);
  }

  function openTextEntry() {
    editedRef.current = false;
    setDraft("");
    setSheetOpen(true);
  }

  function cancelDictation() {
    sessionRef.current?.abandon();
    editedRef.current = false;
    setDraft("");
    setPhase("idle");
  }

  // Save, wherever it is tapped. The session commits it while there still is one; once
  // a point boundary has taken the dictation the panel stays up with no session behind
  // it, so anything the coach types in afterwards is committed from the field itself
  // rather than dropped by a Save with nothing left to call.
  function saveDictation() {
    const session = sessionRef.current;
    if (session !== null) {
      session.finish();
      return;
    }
    const text = draftTextRef.current.trim();
    if (text.length > 0) {
      onAddNoteRef.current(text);
      toast.success("Note saved");
    }
    editedRef.current = false;
    setDraft("");
    setPhase("idle");
  }

  // The point being described is the one the words belong to, so the flow takes them at
  // the boundary rather than letting a later Save land them on the next point. The
  // session ends rather than carrying on: its transcript accumulates across results, so
  // the next one would repeat everything just handed over.
  function takePending(): string {
    if (phase === "idle") return "";
    const text = draftTextRef.current.trim();
    sessionRef.current?.abandon();
    editedRef.current = false;
    setDraft("");
    setPhase("stopped");
    return text;
  }

  // No dependency list: the handle is rebuilt each render so the flow always calls this
  // render's closure, and a stale `phase` can't make it hand over an idle field.
  useImperativeHandle(ref, () => ({ takePending }));

  function startRecording() {
    const Ctor = getSpeechRecognitionCtor();
    if (Ctor === null) {
      openTextEntry();
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.continuous = true;
      // Live partial results, not just the final one, are what let the sheet's field
      // fill in as the coach talks instead of sitting blank until they stop.
      recognition.interimResults = true;
      const session: NoteSession = {
        recognition,
        transcript: "",
        ended: false,
        stopping: false,
        commit: () => {
          const text = draftTextRef.current.trim();
          if (text.length > 0) {
            onAddNoteRef.current(text);
            toast.success("Note saved");
          }
        },
        finish: () => {
          // A second Save, from either affordance, must not re-enter: the commit is
          // already in flight, waiting on the result the service still owes.
          if (session.stopping) return;
          // Per spec, stop() on a session the service already ended does nothing and
          // fires no `end`, so nothing more is coming and the commit belongs here.
          if (session.ended) {
            sessionRef.current = null;
            setPhase("idle");
            session.commit();
            return;
          }
          // A live session still owes a final result, delivered between stop() and
          // `end`, so its commit waits for onend rather than reading a short transcript.
          session.stopping = true;
          recognition.stop();
        },
        abandon: () => {
          // Clearing the ref first is the whole of the suppression: every handler below
          // returns early on a superseded session, so the final result stop() still owes
          // arrives to a session nothing is listening to. Deliberately no `stopping`
          // guard, unlike finish: a point boundary has to beat a Save already in flight,
          // or that commit lands the words on the point after the one they describe.
          sessionRef.current = null;
          if (!session.ended) recognition.stop();
        },
      };
      recognition.onresult = (event) => {
        // Capped here as well as on the textarea: the field's maxLength bounds typing,
        // not a value set from script, and a long dictation arrives in one go.
        session.transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript ?? "")
          .join(" ")
          .slice(0, NOTE_MAX_LENGTH);
        // A superseded session's late result must not overwrite the live one's field,
        // and a coach who's already started correcting the field keeps their own words.
        if (sessionRef.current === session && !editedRef.current) {
          setDraft(session.transcript);
        }
      };
      recognition.onerror = () => {
        // Denied mic, no speech heard, or (some Chromium builds) no connectivity to
        // reach the recognition service — the live panel's field already holds
        // whatever was heard, so hand it to the modal sheet for the coach to save or
        // cancel by hand instead of leaving a dead end. Guarded, or a superseded
        // session's late `aborted` would open the sheet over a still-live recording.
        if (sessionRef.current !== session) return;
        // Abandoned, not finished: the sheet owns that transcript from here, and
        // committing it on this side too would be one note, twice.
        session.abandon();
        setPhase("idle");
        setSheetOpen(true);
      };
      recognition.onend = () => {
        if (sessionRef.current !== session) return;
        if (session.stopping) {
          // The coach's Save: the final result the service owed has arrived by now,
          // so this is where the note is whole and the panel has nothing left to show.
          sessionRef.current = null;
          setPhase("idle");
          session.commit();
          return;
        }
        // `continuous` doesn't stop the service ending a session itself. The mic really
        // is off from here, so say so rather than leaving the panel claiming otherwise.
        session.ended = true;
        setPhase("stopped");
      };
      sessionRef.current = session;
      editedRef.current = false;
      setDraft("");
      setPhase("listening");
      recognition.start();
      // Hold reaches the typed sheet directly, but nothing about the button itself
      // hints that — worth surfacing once, right as a coach starts dictating, since
      // tap and hold do the same thing on a device with no SpeechRecognition at all.
      if (!hasSeenHoldTip("note")) {
        markHoldTipSeen("note");
        toast.info("Tip: press and hold to type instead");
      }
    } catch {
      // iOS Safari throws from the constructor when the speech service is unavailable
      // and Chrome from start(); either would otherwise leave the button in the
      // recording colour with no tap left that reaches the sheet.
      sessionRef.current = null;
      setPhase("idle");
      openTextEntry();
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="icon"
        // Not aria-pressed: once the name itself changes to the new action, a toggle's
        // "Save note, pressed" says nothing a coach can act on.
        aria-label={phase === "idle" ? "Add a note" : "Save note"}
        {...holdHandlers}
        onContextMenu={(event) => {
          // A touch long-press dispatches contextmenu, and left un-prevented it cancels
          // the touch sequence before its click. Unlike skip's handler this calls
          // nothing: the click it keeps alive is what opens the sheet.
          event.preventDefault();
        }}
        onClick={() => {
          // Read before the session branch, or a hold that saved a recording would
          // leave the flag set for the next activation to open the sheet with.
          const held = consumeHold();
          // The panel, not the session: a tap landing between stop() and `end` must
          // reach the session that is mid-commit rather than start a second one over
          // it, and one after a point boundary took the dictation must save what is
          // left in the field rather than clear it by starting afresh.
          if (phase !== "idle") {
            saveDictation();
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
          // Only while the mic is actually live, so the colour keeps meaning that.
          phase === "listening" && "bg-recording text-recording-foreground hover:bg-recording/90",
        )}
      >
        {phase === "idle" ? <MessageCircle className="size-5" /> : <Save className="size-5" />}
      </Button>

      {phase !== "idle" && (
        // Anchored under MatchHeader's own `relative` root, not the viewport — it
        // lands at the top of the screen wherever the header itself sits, with no need
        // to know about the persistent app header above it or fight its stacking.
        // Deliberately not the shared Sheet: see this file's top comment for why a
        // modal here would strand the coach's only way to end the recording.
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelDictation();
          }}
          className="absolute inset-x-0 top-full z-30 mt-1 rounded-sm border border-border bg-popover p-3 text-popover-foreground shadow-xl"
        >
          <p role="status" className="mb-2 text-sm font-medium text-muted-foreground">
            {phase === "listening"
              ? "Listening… tap Save when you're done."
              : "Stopped listening. Save or cancel."}
          </p>
          {/* No autoFocus, unlike the sheet: this is the path where the coach is
              talking, and pulling focus here raises a keyboard over the court on
              Android every time. Focus stays on the button, which is now Save. */}
          <Textarea
            value={draftText}
            onChange={(event) => {
              editedRef.current = true;
              setDraft(event.target.value);
            }}
            placeholder="Speak or type"
            maxLength={NOTE_MAX_LENGTH}
            className="min-h-16"
          />
          <div className="mt-2 grid grid-cols-[1fr_1.4fr] gap-2">
            <Button variant="outline" onClick={cancelDictation} className="h-10 text-base">
              Cancel
            </Button>
            {/* Disabled only once the mic is off: a live session still owes its last
                words, so an empty field now can be a full note by the time it commits. */}
            <Button
              disabled={phase === "stopped" && draftText.trim().length === 0}
              onClick={saveDictation}
              className="h-10 text-base"
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {/* A keyboard or switch activation dispatches a click with no pointerdown, so it
          can never hold: without this there is no route to the typed sheet for anyone
          who can't perform the gesture. Out of the header's flow until it has focus.
          Gone while the panel is up, where it would open the modal sheet over a live
          session and strand the button that ends it, and put a second Cancel on screen. */}
      {phase === "idle" && (
        <button
          type="button"
          onClick={openTextEntry}
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-sm focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-ring"
        >
          Type a note instead
        </button>
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
        }}
      >
        {/* Top, not bottom: a coach's on-screen keyboard covers the bottom of the
            screen, and this field needs to stay visible and editable while it's up,
            whether they're typing from the start or correcting a live transcript. */}
        <SheetContent side="top" className="mx-auto max-w-md gap-4 rounded-b-sm p-5">
          <SheetHeader className="p-0">
            <SheetTitle>Add a note</SheetTitle>
          </SheetHeader>
          <Textarea
            autoFocus
            value={draftText}
            onChange={(event) => {
              editedRef.current = true;
              setDraft(event.target.value);
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
                toast.success("Note saved");
                setSheetOpen(false);
              }}
              className="h-14 text-base"
            >
              Save
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
