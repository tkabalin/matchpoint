import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import type { OutboxEntry, OutboxFailure } from "@/features/outbox/db";
import { append, markFailed, readPending } from "@/features/outbox/outbox";

import { SyncStatus } from "./sync-status";

const drainOutbox = vi.fn().mockResolvedValue({
  acknowledged: 0,
  discarded: 0,
  parked: 0,
  unauthorized: false,
  skipped: false,
});

vi.mock("@/features/sync/drain", () => ({
  drainOutbox: (...args: unknown[]) => drainOutbox(...args),
}));

const COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c1";
const MATCH_ID = "3f1c2b4e-0000-4000-8000-000000000001";

function pointEntry(id: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id,
    coachId: COACH_ID,
    matchId: MATCH_ID,
    kind: "point",
    payload: { id, gameId: "g1" },
    ...overrides,
  };
}

const REFUSED: OutboxFailure = { status: 404, message: "Unknown player_id" };

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

beforeEach(async () => {
  await outboxDb.delete();
  await outboxDb.open();
  setOnline(true);
});

afterEach(() => {
  drainOutbox.mockClear();
});

test("renders nothing once everything has synced", async () => {
  const { container } = render(<SyncStatus coachId={COACH_ID} />);

  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

test("shows a quiet pending count while points are waiting to sync", async () => {
  await append(pointEntry("p1"));

  render(<SyncStatus coachId={COACH_ID} />);

  expect(await screen.findByText("1 syncing")).toBeInTheDocument();
});

test("pluralizes the pending count", async () => {
  await append(pointEntry("p1"));
  await append(pointEntry("p2"));

  render(<SyncStatus coachId={COACH_ID} />);

  expect(await screen.findByText("2 syncing")).toBeInTheDocument();
});

test("shows a reassurance note instead of the pending badge while offline", async () => {
  await append(pointEntry("p1"));
  setOnline(false);

  render(<SyncStatus coachId={COACH_ID} />);

  expect(
    await screen.findByText("Offline — 1 point will sync when reconnected"),
  ).toBeInTheDocument();
  expect(screen.queryByText("1 syncing")).not.toBeInTheDocument();
});

test("the offline note still shows with nothing queued", async () => {
  setOnline(false);

  render(<SyncStatus coachId={COACH_ID} />);

  expect(
    await screen.findByText("Offline — recording continues, will sync when reconnected"),
  ).toBeInTheDocument();
});

test("shows the failed count, taking priority over a pending one", async () => {
  await append(pointEntry("p1"));
  await append(pointEntry("p2"));
  await markFailed(["p2"], REFUSED);

  render(<SyncStatus coachId={COACH_ID} />);

  expect(await screen.findByText("1 point failed")).toBeInTheDocument();
  expect(screen.queryByText(/syncing/)).not.toBeInTheDocument();
});

test("opening the failed badge lists grouped rejection reasons", async () => {
  await append(pointEntry("p1"));
  await append(pointEntry("p2"));
  await append(pointEntry("p3"));
  await markFailed(["p1", "p2"], REFUSED);
  await markFailed(["p3"], { status: 409, message: "Match is completed" });

  const user = userEvent.setup();
  render(<SyncStatus coachId={COACH_ID} />);
  await user.click(await screen.findByText("3 points failed"));

  expect(await screen.findByText("Unknown player_id")).toBeInTheDocument();
  expect(screen.getByText("Match is completed")).toBeInTheDocument();
  // Grouped: two rows shared the same reason, so it reads as one line with a count
  // of 2 rather than twice.
  expect(screen.getAllByText("2")).toHaveLength(1);
});

test("Retry returns the failed rows to pending and runs the drain", async () => {
  await append(pointEntry("p1"));
  await markFailed(["p1"], REFUSED);

  const user = userEvent.setup();
  render(<SyncStatus coachId={COACH_ID} />);
  await user.click(await screen.findByText("1 point failed"));
  await user.click(await screen.findByRole("button", { name: "Retry" }));

  await waitFor(() => expect(drainOutbox).toHaveBeenCalledWith(COACH_ID, expect.any(String)));
  const [row] = await readPending(COACH_ID);
  expect(row?.id).toBe("p1");
  expect(row?.failure).toBeUndefined();
});
