import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SquadTrendCard } from "./squad-trend-card";

function stubTrendResponse(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname !== "/api/squad/analytics/trend") {
        throw new Error(`Unstubbed fetch: ${input.method} ${pathname}`);
      }
      return Promise.resolve(Response.json(body));
    }),
  );
}

function renderTrend(metric: "record" | "forcedToUnforced" | "firstServe" = "record") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SquadTrendCard metric={metric} onMetricChange={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// #300: a squad that's gone quiet for most of a six-week window (`get_squad_trend`'s
// own doc comment says a week with no decided match carries null, not zero) turns
// into a trend of mostly nulls and one real value near the bottom. Left on Recharts'
// auto Y-axis domain, that lone value - with no sense that it's a percentage -
// computed a small arbitrary ceiling (4, in production) instead of the 0-100 the
// metric actually spans, rendering a chart that looked empty/broken even though real
// data was there. Reproduced against the real component via a live Playwright run
// before this test was written, not just inferred from the code.
test("a mostly-null win-percentage trend still scales its axis to 0-100, not to the one real value", async () => {
  stubTrendResponse([
    { week: "Wk 1", value: null },
    { week: "Wk 2", value: null },
    { week: "Wk 3", value: null },
    { week: "Wk 4", value: null },
    { week: "Wk 5", value: null },
    { week: "Wk 6", value: 0 },
  ]);

  renderTrend("record");

  expect(await screen.findByText("100")).toBeInTheDocument();
  expect(screen.queryByText("4")).not.toBeInTheDocument();
});

// Same shape, the other percentage metric.
test("a mostly-null first-serve trend also scales to 0-100", async () => {
  stubTrendResponse([
    { week: "Wk 1", value: null },
    { week: "Wk 2", value: null },
    { week: "Wk 3", value: null },
    { week: "Wk 4", value: null },
    { week: "Wk 5", value: null },
    { week: "Wk 6", value: 0 },
  ]);

  renderTrend("firstServe");

  expect(await screen.findByText("100")).toBeInTheDocument();
});

// Forced:unforced is a genuine ratio with no natural 0-100 ceiling to fix it to
// (analytics.py's `_series_ratio` is unbounded above), so it keeps an auto-scaled
// top - but still floors at 0 rather than letting the same degenerate-domain
// computation pick an arbitrary or negative-feeling range for a single data point.
test("a mostly-null forced:unforced trend still floors its axis at 0", async () => {
  stubTrendResponse([
    { week: "Wk 1", value: null },
    { week: "Wk 2", value: null },
    { week: "Wk 3", value: null },
    { week: "Wk 4", value: null },
    { week: "Wk 5", value: null },
    { week: "Wk 6", value: 2.5 },
  ]);

  renderTrend("forcedToUnforced");

  expect(await screen.findByText("0")).toBeInTheDocument();
});

// #300 follow-up: a week with no value still reached the custom dot renderer with a
// null `cy`, which SVG reads as 0, so every empty week drew a circle on the plot's top
// edge (half clipped into a "dash") - a quiet squad's chart looked broken even with its
// axis fixed. No circle may carry a missing position; only real points get one.
test("weeks with no value draw no dot at all, rather than one on the top edge", async () => {
  stubTrendResponse([
    { week: "Wk 1", value: null },
    { week: "Wk 2", value: null },
    { week: "Wk 3", value: null },
    { week: "Wk 4", value: null },
    { week: "Wk 5", value: null },
    { week: "Wk 6", value: 0 },
  ]);

  const { container } = renderTrend("record");
  await screen.findByText("100");

  const dots = [...container.querySelectorAll("svg.recharts-surface circle")];
  expect(dots.length).toBeGreaterThan(0);
  expect(dots.filter((dot) => dot.getAttribute("cy") === null)).toEqual([]);
  expect(dots).toHaveLength(1);
});
