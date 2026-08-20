import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { PlayerAvatar } from "./player-avatar";

test("renders the player's initials", () => {
  render(
    <PlayerAvatar
      player={{ id: "1", first_name: "Amahle", last_name: "Nkosi", photo_url: null }}
    />,
  );

  expect(screen.getByText("AN")).toBeInTheDocument();
});

test("picks the same color for the same id", () => {
  const player = {
    id: "3f1c2b4e-0000-4000-8000-000000000001",
    first_name: "A",
    last_name: "B",
    photo_url: null,
  };

  const { container: first } = render(<PlayerAvatar player={player} />);
  const { container: second } = render(<PlayerAvatar player={player} />);

  expect(first.firstElementChild?.getAttribute("style")).toEqual(
    second.firstElementChild?.getAttribute("style"),
  );
});

test("renders the photo instead of initials once one is set", () => {
  render(
    <PlayerAvatar
      player={{
        id: "1",
        first_name: "Amahle",
        last_name: "Nkosi",
        photo_url: "/api/media/abc.webp",
      }}
    />,
  );

  // alt="" is deliberate (decorative; the name is shown as text elsewhere), which
  // computes to role="presentation" rather than "img" — getByAltText matches on the
  // attribute directly rather than the computed role, so it still finds it.
  expect(screen.getByAltText("")).toHaveAttribute("src", "/api/media/abc.webp");
  expect(screen.queryByText("AN")).not.toBeInTheDocument();
});

test("shows no camera badge by default", () => {
  const { container } = render(
    <PlayerAvatar
      player={{ id: "1", first_name: "Amahle", last_name: "Nkosi", photo_url: null }}
    />,
  );

  expect(container.querySelector("svg")).not.toBeInTheDocument();
});

test("shows a camera badge when editable", () => {
  const { container } = render(
    <PlayerAvatar
      player={{ id: "1", first_name: "Amahle", last_name: "Nkosi", photo_url: null }}
      editable
    />,
  );

  expect(container.querySelector("svg")).toBeInTheDocument();
});

test("falls back to initials if the photo fails to load", () => {
  render(
    <PlayerAvatar
      player={{
        id: "1",
        first_name: "Amahle",
        last_name: "Nkosi",
        photo_url: "/api/media/broken.webp",
      }}
    />,
  );

  // A load failure isn't a user interaction, so fireEvent rather than user-event —
  // React attaches img's error listener directly to the node (it doesn't bubble), and
  // fireEvent is what reliably reaches that.
  fireEvent.error(screen.getByAltText(""));

  expect(screen.getByText("AN")).toBeInTheDocument();
});
