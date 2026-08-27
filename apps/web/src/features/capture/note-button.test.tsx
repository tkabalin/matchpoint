import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { NoteButton } from "./note-button";
import { NOTE_MAX_LENGTH } from "./point";

/** A stand-in for the browser's SpeechRecognition — jsdom implements neither. */
class FakeSpeechRecognition extends EventTarget {
  continuous = false;
  interimResults = false;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null =
    null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  // The real API fires onend asynchronously once recognition actually stops — the
  // fake fires it synchronously, which is close enough for these assertions.
  stop = vi.fn(() => {
    this.onend?.();
  });
}

function installFakeSpeechRecognition() {
  const instances: FakeSpeechRecognition[] = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class extends (
    FakeSpeechRecognition
  ) {
    constructor() {
      super();
      instances.push(this);
    }
  };
  return instances;
}

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

test("no SpeechRecognition on the window: tapping opens the text sheet directly", async () => {
  const user = userEvent.setup();
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
});

test("SpeechRecognition present: tapping starts recording instead of opening the sheet", async () => {
  installFakeSpeechRecognition();
  const user = userEvent.setup();
  render(<NoteButton onAddNote={vi.fn()} />);

  const button = screen.getByRole("button", { name: "Add a note" });
  await user.click(button);

  expect(screen.getByRole("button", { name: "Stop recording note" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();
});

test("stopping a recording adds the transcript as a note", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup();
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

test("a dictated note longer than the API accepts is capped, not sent whole", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup();
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
  const user = userEvent.setup();
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByPlaceholderText("What happened?")).toHaveAttribute(
    "maxlength",
    String(NOTE_MAX_LENGTH),
  );
});

test("stopping with no speech heard adds nothing", async () => {
  installFakeSpeechRecognition();
  const user = userEvent.setup();
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.click(screen.getByRole("button", { name: "Stop recording note" }));

  expect(onAddNote).not.toHaveBeenCalled();
});

test("a recognition error falls back to the text sheet, pre-filled with what was heard so far", async () => {
  const instances = installFakeSpeechRecognition();
  const user = userEvent.setup();
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  act(() => {
    instances[0]?.onresult?.({ results: [[{ transcript: "partial thought" }]] });
    instances[0]?.onerror?.();
  });

  expect(screen.getByRole("heading", { name: "Add a note" })).toBeVisible();
  expect(screen.getByPlaceholderText("What happened?")).toHaveValue("partial thought");
});

test("cancel closes the sheet without adding a note", async () => {
  const user = userEvent.setup();
  const onAddNote = vi.fn();
  render(<NoteButton onAddNote={onAddNote} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.type(screen.getByPlaceholderText("What happened?"), "never mind");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onAddNote).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Add a note" })).not.toBeInTheDocument();
});

test("the sheet's Add note button is disabled until there's text to add", async () => {
  const user = userEvent.setup();
  render(<NoteButton onAddNote={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Add a note" }));

  expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
});
