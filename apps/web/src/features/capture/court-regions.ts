/**
 * The court's own regions, as the grid a screen lays cards onto.
 *
 * Their own module rather than court-diagram.tsx's: a file that exports a component
 * may export only components if fast refresh is to work, and these are shared by two
 * screens that draw over the court (see rally-screen.tsx and final-shot-screen.tsx).
 */

/**
 * The court's own regions as grid tracks, so a screen laying cards over the court can put
 * one inside a region rather than near it: gutter, backcourt, service line, service box,
 * net, and back down the other side. Equal fractions can't do this, since a backcourt and
 * a service box are different depths. Line numbers are in COURT_COLUMNS/COURT_ROWS below.
 */
export const COURT_REGION_COLUMNS = "18.79% 29.69% 3.03% 29.7% 18.79%";

export const COURT_REGION_GRID: React.CSSProperties = {
  gridTemplateColumns: COURT_REGION_COLUMNS,
  // The net is 26px rather than a percentage, so the two service-box rows give it back.
  gridTemplateRows:
    "7.7% 18.23% 2.315% calc(21.755% - 13px) 26px calc(21.76% - 13px) 2.315% 18.225% 7.7%",
};

/** Column lines into COURT_REGION_GRID: left and right of the centre service line. */
export const COURT_COLUMNS = [2, 4];

/** Row lines into COURT_REGION_GRID, top to bottom: backcourt, service box, service box, backcourt. */
export const COURT_ROWS = [2, 4, 6, 8];
