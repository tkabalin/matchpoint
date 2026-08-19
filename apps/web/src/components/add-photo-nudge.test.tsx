import type { CoachRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { AddPhotoNudge } from "./add-photo-nudge";

// Same reasoning as profile.test.tsx: jsdom has no canvas/createImageBitmap, and
// downscaling itself is covered by downscale-image.test.ts.
vi.mock("@/lib/downscale-image", () => ({
  downscaleImage: (file: File) => Promise.resolve(file),
}));

const coach: CoachRead = {
  id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  email: "jamie@example.com",
  display_name: "Jamie Chen",
  default_surface: null,
  default_scoring_system: null,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const handler = routes[`${input.method} ${pathname}`];
      if (!handler) throw new Error(`Unstubbed fetch: ${input.method} ${pathname}`);
      return Promise.resolve(handler());
    }),
  );
}

function renderNudge(seed: CoachRead = coach) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AddPhotoNudge coach={seed} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("shows the nudge for a coach with no photo", () => {
  renderNudge();

  expect(screen.getByText("Add a profile photo")).toBeInTheDocument();
});

test("shows nothing once the coach already has a photo", () => {
  renderNudge({ ...coach, photo_url: "/api/media/abc.webp" });

  expect(screen.queryByText("Add a profile photo")).not.toBeInTheDocument();
});

test("hides itself once dismissed, and stays hidden across a remount", async () => {
  const user = userEvent.setup();
  renderNudge();

  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("Add a profile photo")).not.toBeInTheDocument();

  renderNudge();
  expect(screen.queryByText("Add a profile photo")).not.toBeInTheDocument();
});

test("choosing a photo uploads it and closes the picker", async () => {
  stubFetch({
    "POST /api/coaches/me/photo": () =>
      Response.json({ ...coach, photo_url: "/api/media/abc.webp" }),
  });
  const user = userEvent.setup();
  renderNudge();

  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(await screen.findByRole("button", { name: "Choose photo" }));
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);

  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "Choose photo" })).not.toBeInTheDocument();
  });
});
