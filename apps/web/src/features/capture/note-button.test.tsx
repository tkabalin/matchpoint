import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";

import { NoteButton } from "./note-button";
import { NOTE_MAX_LENGTH } from "./point";

/** Holds past HOLD_MS and lets go, the gesture that reaches the typed-note sheet. */
async function holdAndRelease(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  await user.pointer({ keys: "[MouseLeft>]", target });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await user.pointer({ keys: "[/MouseLeft]", target });
}

/** A stand-in for the browser's SpeechRecognition — jsdom implements neither. */
class FakeSpeechRecognition extends EventTarget {
  continuous = false;
  interimResults = false;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null =
    null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  /** A last result the service still owes at the moment the coach taps Save. */
  pendingFinalTranscript = "";
  start = vi.fn();
  // The real API fires onend asynchronously once recognition actually stops — the
  // fake fires it synchronously, which is close enough for these assertions. Where a
  // final result is still owed, stop() has to return before it, so that one defers.
  stop = vi.fn(() => {
    if (this.pendingFinalTranscript !== "") return;
    this.onend?.();
  });
  /** What the browser delivers after stop() returns: the last result, then `end`. */
  flushAfterStop() {
    this.onresult?.({ results: [[{ transcript: this.pendingFinalTranscript }]] });
    this.onend?.();
  }
}

function installFakeSpeechRecognition({
  startThrows = false,
  constructionThrows = false,
  finalResult = "",
} = {}) {
  const instances: FakeSpeechRecognition[] = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class extends (
    FakeSpeechRecognition
  ) {
    constructor() {
      super();
      // iOS Safari throws from the constructor when the speech service is unavailable.
      if (constructionThrows) throw new Error("speech recognition is unavailable");
      // Chrome throws synchronously from start() when a recognition is already running.
      if (startThrows) {
        this.start = vi.fn(() => {
          throw new Error("recognition has already started");
        });
      }
      this.pendingFinalTranscript = finalResult;
      instances.push(this);
    }
  };
  return instances;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  localStorage.clear();
  // Sonner's toast queue lives outside React, so a toast pushed in one test would
  // otherwise still be sitting there for the next Toaster mount to render.
  toast.dismiss();
});

test("no SpeechRecognition on the window: tapping opens the text sheet directly", async () => {
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
});

test("SpeechRecognition present: tapping starts recording instead of opening the sheet", async () => {
  installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  const button = screen.getByRole("button", { name: "Add a note" });
  await user.click(button);

  expect(screen.getByRole("button", { name: "Save note" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();
});

test("holding opens the text sheet without ever reaching for the mic", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await holdAndRelease(user, screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
  expect(screen.getByPlaceholderText("What happened?")).toHaveValue("");
  // Neither the hold nor the click its release produces may start a recording.
  expect(instances).toHaveLength(0);
});

test("a hold on a touch screen opens the sheet, though its release fires pointerleave first", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  const button = screen.getByRole("button", { name: "Add a note" });
  await user.pointer({ keys: "[TouchA>]", target: button });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await user.pointer({ keys: "[/TouchA]", target: button });

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
  expect(instances).toHaveLength(0);
});

test("a hold is spent by its own click, so the next activation dictates again", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await holdAndRelease(user, screen.getByRole("button", { name: "Add a note" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  // A keyboard activation is the only one that can catch a flag left set: a tap would
  // clear it on its own pointerdown, and so would pass either way.
  const button = screen.getByRole("button", { name: "Add a note" });
  button.focus();
  await user.keyboard("{Enter}");

  expect(instances).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Save note" })).toBeVisible();
});

test("holding while recording saves the note, rather than opening the sheet", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "serving into the body" }]] });
  });
  await holdAndRelease(user, screen.getByRole("button", { name: "Save note" }));

  expect(onAddNote).toHaveBeenCalledWith("serving into the body");
  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();

  // The hold the stop spent must not be left over for the next activation, which a
  // keyboard one is the only way to catch: a tap would clear it on its pointerdown.
  const button = screen.getByRole("button", { name: "Add a note" });
  button.focus();
  await user.keyboard("{Enter}");

  expect(instances).toHaveLength(2);
  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();
});

test("holding while a session the service ended is pending adds the note once, not the sheet", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "second serve sitting up" }]] });
    // The service ending the session on a silence: the mic is already off, so the
    // commit is owed to the next activation.
    instances[0]?.onend?.();
  });
  await holdAndRelease(user, screen.getByRole("button", { name: "Save note" }));

  expect(onAddNote).toHaveBeenCalledTimes(1);
  expect(onAddNote).toHaveBeenCalledWith("second serve sitting up");
  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();
});

test("a touch long-press's contextmenu is prevented, so the click it precedes survives", () => {
  render(<NoteButton onAddNote={vi.fn()} />);

  // fireEvent rather than user-event: what's under test is the default being
  // prevented, which is the dispatch's own return value rather than anything on screen.
  const notPrevented = fireEvent.contextMenu(screen.getByRole("button", { name: "Add a note" }));

  expect(notPrevented).toBe(false);
});

test("the typed sheet is reachable by keyboard, which can't perform the hold", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.tab();
  await user.tab();
  expect(screen.getByRole("button", { name: "Type a note instead" })).toHaveFocus();
  await user.keyboard("{Enter}");

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
  expect(screen.getByPlaceholderText("What happened?")).toHaveValue("");
  expect(instances).toHaveLength(0);
});

test("saving a recording adds the transcript as a note", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  instances[0]?.onresult?.({ results: [[{ transcript: "favoring the backhand" }]] });
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(onAddNote).toHaveBeenCalledWith("favoring the backhand");
  expect(screen.getByRole("button", { name: "Add a note" })).toBeVisible();
});

test("the field fills in live as speech results arrive while recording", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  expect(screen.getByPlaceholderText("Speak or type")).toHaveValue("");
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "serving into the body" }]] });
  });

  expect(screen.getByPlaceholderText("Speak or type")).toHaveValue("serving into the body");
});

test("typing into the field mid-recording keeps the coach's edit, not later speech", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "serving into the body" }]] });
  });
  const field = screen.getByPlaceholderText("Speak or type");
  await user.clear(field);
  await user.type(field, "actually the forehand");
  act(() => {
    // More speech arrives after the coach has started correcting the field — it must
    // not clobber a correction they've already made.
    instances[0]?.onresult?.({ results: [[{ transcript: "serving into the body, twice" }]] });
  });

  expect(field).toHaveValue("actually the forehand");

  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(onAddNote).toHaveBeenCalledWith("actually the forehand");
});

test("a note goes to the caller's latest handler, not the one recording started with", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const atRecordStart = vi.fn();
  const afterMorePoints = vi.fn();
  const { rerender } = render(<NoteButton onAddNote={atRecordStart} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "crowding the baseline" }]] });
  });
  // Points captured while the coach dictates hand down a handler over newer state.
  rerender(<NoteButton onAddNote={afterMorePoints} />);
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(atRecordStart).not.toHaveBeenCalled();
  expect(afterMorePoints).toHaveBeenCalledWith("crowding the baseline");
});

test("the last words before Save are part of the note, not cut off", async () => {
  const instances = installFakeSpeechRecognition({
    finalResult: "second serve sitting up, punish the forehand",
  });
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "second serve sitting up" }]] });
  });
  await user.click(screen.getByRole("button", { name: "Save note" }));
  // Nothing is added until the service has handed back everything it heard.
  expect(onAddNote).not.toHaveBeenCalled();
  act(() => {
    instances[0]?.flushAfterStop();
  });

  expect(onAddNote).toHaveBeenCalledWith("second serve sitting up, punish the forehand");
  expect(screen.getByRole("button", { name: "Add a note" })).toBeVisible();
});

test("a dictated note longer than the API accepts is capped, not sent whole", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  const dictated = "long thought ".repeat(400);
  expect(dictated.length).toBeGreaterThan(NOTE_MAX_LENGTH);
  instances[0]?.onresult?.({ results: [[{ transcript: dictated }]] });
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(onAddNote).toHaveBeenCalledWith(dictated.slice(0, NOTE_MAX_LENGTH).trim());
});

test("the typed note field stops at the same length the API accepts", async () => {
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByPlaceholderText("What happened?")).toHaveAttribute(
    "maxlength",
    String(NOTE_MAX_LENGTH),
  );
});

test("saving with no speech heard adds nothing", async () => {
  installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(onAddNote).not.toHaveBeenCalled();
});

test("a session the service ends by itself says so, and the next tap adds the note once", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "second serve sitting up" }]] });
    // No stop() from the coach: this is the service ending the session on a silence.
    instances[0]?.onend?.();
  });

  expect(onAddNote).not.toHaveBeenCalled();
  const saveButton = screen.getByRole("button", { name: "Save note" });
  expect(screen.getByText("Stopped listening. Save or cancel.")).toBeVisible();

  await user.click(saveButton);

  expect(onAddNote).toHaveBeenCalledTimes(1);
  expect(onAddNote).toHaveBeenCalledWith("second serve sitting up");
  expect(screen.getByRole("button", { name: "Add a note" })).toBeVisible();
});

test("a session that ends by itself with nothing heard adds nothing", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onend?.();
  });
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(onAddNote).not.toHaveBeenCalled();
});

test("the panel says how to finish while the mic is live", async () => {
  installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByText("Listening\u2026 tap Save when you're done.")).toBeVisible();
});

test("the panel's own Save adds the note, the same as the button above it", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "drifting behind the baseline" }]] });
  });
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(onAddNote).toHaveBeenCalledWith("drifting behind the baseline");
  expect(screen.getByRole("button", { name: "Add a note" })).toBeVisible();
});

test("the panel's Save waits for the last words the service owes", async () => {
  const instances = installFakeSpeechRecognition({ finalResult: "pushing the return deep" });
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onAddNote).not.toHaveBeenCalled();
  act(() => {
    instances[0]?.flushAfterStop();
  });

  expect(onAddNote).toHaveBeenCalledWith("pushing the return deep");
});

test("a second Save, on either control, still adds the note once", async () => {
  const instances = installFakeSpeechRecognition({ finalResult: "serving wide on the deuce" });
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  // The panel stays up between stop() and `end`, so both Saves are still on screen.
  await user.click(screen.getByRole("button", { name: "Save note" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  act(() => {
    instances[0]?.flushAfterStop();
  });

  expect(onAddNote).toHaveBeenCalledTimes(1);
});

test("Save stays available before any speech arrives, and goes once the mic is off with none", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  // A live session still owes its last words, so an empty field now can be a note later.
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  act(() => {
    instances[0]?.onend?.();
  });

  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("cancelling a dictation adds nothing and stands the button down", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "never mind that one" }]] });
  });
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onAddNote).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Add a note" })).toBeVisible();
  expect(screen.queryByPlaceholderText("Speak or type")).not.toBeInTheDocument();
});

test("cancelling a live dictation releases the mic", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(instances[0]?.stop).toHaveBeenCalled();
});

test("a cancelled session's last words never land as a note", async () => {
  const instances = installFakeSpeechRecognition({ finalResult: "words the coach threw away" });
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  // The result stop() still owed arrives to a session nothing is listening to.
  act(() => {
    instances[0]?.flushAfterStop();
  });

  expect(onAddNote).not.toHaveBeenCalled();
  expect(screen.queryByPlaceholderText("Speak or type")).not.toBeInTheDocument();
});

test("cancelling a session the service already ended adds nothing and doesn't stop it twice", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "heard but not wanted" }]] });
    instances[0]?.onend?.();
  });
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onAddNote).not.toHaveBeenCalled();
  expect(instances[0]?.stop).not.toHaveBeenCalled();
});

test("a cancelled dictation leaves the next one blank", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "never mind that one" }]] });
  });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByPlaceholderText("Speak or type")).toHaveValue("");
});

test("Escape from the field discards the dictation", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "scrap this" }]] });
  });
  await user.click(screen.getByPlaceholderText("Speak or type"));
  await user.keyboard("{Escape}");

  expect(onAddNote).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Add a note" })).toBeVisible();
});

test("the typed-note escape hatch is out of the way while the panel is up", async () => {
  installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  // It opens the modal sheet, which over a live session would strand the very button
  // that ends it, and would put a second Cancel on screen beside the panel's own.
  expect(screen.queryByRole("button", { name: "Type a note instead" })).not.toBeInTheDocument();
});

test("a recognition that refuses to start falls back to the text sheet, not a stuck button", async () => {
  installFakeSpeechRecognition({ startThrows: true });
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Add a note" })).toBeVisible();
});

test("a recognition that can't be constructed at all falls back to the text sheet", async () => {
  installFakeSpeechRecognition({ constructionThrows: true });
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
});

test("a recognition error falls back to the text sheet, pre-filled with what was heard so far", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "partial thought" }]] });
    instances[0]?.onerror?.();
  });

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
  expect(screen.getByPlaceholderText("What happened?")).toHaveValue("partial thought");
});

test("an errored session never auto-adds what it heard, since the sheet already holds it", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "partial thought" }]] });
    // The real API fires end after error, which is what used to land the note twice.
    instances[0]?.onerror?.();
    instances[0]?.onend?.();
  });

  expect(onAddNote).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText("What happened?")).toHaveValue("partial thought");
});

test("a superseded session's late error doesn't open the sheet over a live recording", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "first note" }]] });
  });
  await user.click(screen.getByRole("button", { name: "Save note" }));
  await user.click(screen.getByRole("button", { name: "Add a note" }));

  // A stopped session raises `aborted` after the next one is already listening.
  act(() => {
    instances[0]?.onerror?.();
  });

  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save note" })).toBeVisible();
  expect(onAddNote).toHaveBeenCalledTimes(1);
});

test("a superseded session's late end doesn't stand down a live recording", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "first note" }]] });
  });
  await user.click(screen.getByRole("button", { name: "Save note" }));
  await user.click(screen.getByRole("button", { name: "Add a note" }));

  act(() => {
    instances[0]?.onend?.();
  });

  expect(screen.getByRole("button", { name: "Save note" })).toBeVisible();
  expect(onAddNote).toHaveBeenCalledTimes(1);
});

test("after a recognition error the next tap records afresh, adding only the new note", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "lost to a mic error" }]] });
    instances[0]?.onerror?.();
  });
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[1]?.onresult?.({ results: [[{ transcript: "returning from the baseline" }]] });
  });
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(onAddNote).toHaveBeenCalledTimes(1);
  expect(onAddNote).toHaveBeenCalledWith("returning from the baseline");
});

test("navigating away mid-dictation still adds what was heard", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  const { unmount } = render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "chasing every ball down" }]] });
  });
  unmount();

  expect(onAddNote).toHaveBeenCalledWith("chasing every ball down");
});

test("navigating away after a recognition error adds nothing, since the sheet held it", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  const { unmount } = render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "partial thought" }]] });
    instances[0]?.onerror?.();
  });
  unmount();

  expect(onAddNote).not.toHaveBeenCalled();
});

test("cancel closes the sheet without adding a note", async () => {
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.type(screen.getByPlaceholderText("What happened?"), "never mind");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onAddNote).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();
});

test("the sheet's Save button is disabled until there's text to add", async () => {
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("saving a recording shows a confirmation toast", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(
    <>
      <Toaster />
      <NoteButton onAddNote={vi.fn()} />
    </>,
  );

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  instances[0]?.onresult?.({ results: [[{ transcript: "favoring the backhand" }]] });
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(await screen.findByText("Note saved")).toBeInTheDocument();
});

test("adding a typed note from the sheet shows a confirmation toast", async () => {
  const user = userEvent.setup({ delay: null });
  render(
    <>
      <Toaster />
      <NoteButton onAddNote={vi.fn()} />
    </>,
  );

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.type(screen.getByPlaceholderText("What happened?"), "chasing every ball down");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Note saved")).toBeInTheDocument();
});

test("the first recording ever started on this device shows a one-time hold hint", async () => {
  installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(
    <>
      <Toaster />
      <NoteButton onAddNote={vi.fn()} />
    </>,
  );

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(await screen.findByText("Tip: press and hold to type instead")).toBeInTheDocument();
});

test("a second recording on the same device doesn't repeat the hold hint", async () => {
  // Asserted on the call itself rather than the DOM: Sonner auto-dismisses a toast
  // a few seconds in, and waiting that out for real on every run just to look for
  // its absence would make this test needlessly slow.
  const infoSpy = vi.spyOn(toast, "info");
  installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.click(screen.getByRole("button", { name: "Save note" }));
  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(infoSpy).toHaveBeenCalledTimes(1);
});

test("no hold hint when tapping falls straight to the text sheet", async () => {
  const user = userEvent.setup({ delay: null });
  render(
    <>
      <Toaster />
      <NoteButton onAddNote={vi.fn()} />
    </>,
  );

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.queryByText("Tip: press and hold to type instead")).not.toBeInTheDocument();
});
