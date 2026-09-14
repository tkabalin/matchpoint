import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  /** A last result the service still owes at the moment the coach taps Stop. */
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
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
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

  expect(screen.getByRole("button", { name: "Stop recording note" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
  expect(screen.getByRole("button", { name: "Stop recording note" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("holding while recording stops and adds the note, rather than opening the sheet", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "serving into the body" }]] });
  });
  await holdAndRelease(user, screen.getByRole("button", { name: "Stop recording note" }));

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
    // The service ending the session on a silence: the mic is already off while the
    // button still reads as recording, so the commit is owed to the next activation.
    instances[0]?.onend?.();
  });
  await holdAndRelease(user, screen.getByRole("button", { name: "Stop recording note" }));

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

test("stopping a recording adds the transcript as a note", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  instances[0]?.onresult?.({ results: [[{ transcript: "favoring the backhand" }]] });
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

  expect(onAddNote).toHaveBeenCalledWith("favoring the backhand");
  expect(screen.getByRole("button", { name: "Add a note" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("the field fills in live as speech results arrive while recording", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  expect(screen.getByPlaceholderText("What happened?")).toHaveValue("");
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "serving into the body" }]] });
  });

  expect(screen.getByPlaceholderText("What happened?")).toHaveValue("serving into the body");
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
  const field = screen.getByPlaceholderText("What happened?");
  await user.clear(field);
  await user.type(field, "actually the forehand");
  act(() => {
    // More speech arrives after the coach has started correcting the field — it must
    // not clobber a correction they've already made.
    instances[0]?.onresult?.({ results: [[{ transcript: "serving into the body, twice" }]] });
  });

  expect(field).toHaveValue("actually the forehand");

  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

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
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

  expect(atRecordStart).not.toHaveBeenCalled();
  expect(afterMorePoints).toHaveBeenCalledWith("crowding the baseline");
});

test("the last words before Stop are part of the note, not cut off", async () => {
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
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));
  // Nothing is added until the service has handed back everything it heard.
  expect(onAddNote).not.toHaveBeenCalled();
  act(() => {
    instances[0]?.flushAfterStop();
  });

  expect(onAddNote).toHaveBeenCalledWith("second serve sitting up, punish the forehand");
  expect(screen.getByRole("button", { name: "Add a note" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

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

test("stopping with no speech heard adds nothing", async () => {
  installFakeSpeechRecognition();
  const user = userEvent.setup({ delay: null });
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

  expect(onAddNote).not.toHaveBeenCalled();
});

test("a session the service ends by itself keeps recording, and the next tap adds the note once", async () => {
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
  const stopButton = screen.getByRole("button", { name: "Stop recording note" });
  expect(stopButton).toHaveAttribute("aria-pressed", "true");

  await user.click(stopButton);

  expect(onAddNote).toHaveBeenCalledTimes(1);
  expect(onAddNote).toHaveBeenCalledWith("second serve sitting up");
  expect(screen.getByRole("button", { name: "Add a note" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

  expect(onAddNote).not.toHaveBeenCalled();
});

test("a recognition that refuses to start falls back to the text sheet, not a stuck button", async () => {
  installFakeSpeechRecognition({ startThrows: true });
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Add a note" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));
  await user.click(screen.getByRole("button", { name: "Add a note" }));

  // A stopped session raises `aborted` after the next one is already listening.
  act(() => {
    instances[0]?.onerror?.();
  });

  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop recording note" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));
  await user.click(screen.getByRole("button", { name: "Add a note" }));

  act(() => {
    instances[0]?.onend?.();
  });

  expect(screen.getByRole("button", { name: "Stop recording note" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

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

test("the sheet's Add note button is disabled until there's text to add", async () => {
  const user = userEvent.setup({ delay: null });
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
});

test("stopping a recording shows a confirmation toast", async () => {
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
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

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
  await user.click(screen.getByRole("button", { name: "Add note" }));

  expect(await screen.findByText("Note saved")).toBeInTheDocument();
});
