import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { PhotoAvatar } from "./photo-avatar";

test("renders initials when no photo is set", () => {
  render(<PhotoAvatar id="1" initials="JC" photoUrl={null} />);

  expect(screen.getByText("JC")).toBeInTheDocument();
});

test("renders a circle for the profile shape", () => {
  render(<PhotoAvatar id="1" initials="JC" photoUrl={null} shape="circle" />);

  expect(screen.getByText("JC")).toHaveClass("rounded-full");
});

test("renders a square for the default (roster) shape", () => {
  render(<PhotoAvatar id="1" initials="JC" photoUrl={null} />);

  expect(screen.getByText("JC")).toHaveClass("rounded-sm");
});

test("renders the photo, sized and shaped the same way, once one is set", () => {
  render(<PhotoAvatar id="1" initials="JC" photoUrl="/api/media/abc.webp" shape="circle" />);

  // alt="" is deliberate (decorative; the name is shown as text next to it), which
  // computes to role="presentation" rather than "img" — getByAltText matches on the
  // attribute directly rather than the computed role, so it still finds it.
  const img = screen.getByAltText("");
  expect(img).toHaveAttribute("src", "/api/media/abc.webp");
  expect(img).toHaveClass("rounded-full");
});

test("shows no camera badge by default", () => {
  const { container } = render(<PhotoAvatar id="1" initials="JC" photoUrl={null} />);

  expect(container.querySelector("svg")).not.toBeInTheDocument();
});

test("shows a camera badge when editable, over initials or a photo alike", () => {
  const { container: withInitials } = render(
    <PhotoAvatar id="1" initials="JC" photoUrl={null} editable />,
  );
  expect(withInitials.querySelector("svg")).toBeInTheDocument();

  const { container: withPhoto } = render(
    <PhotoAvatar id="1" initials="JC" photoUrl="/api/media/abc.webp" editable />,
  );
  expect(withPhoto.querySelector("svg")).toBeInTheDocument();
});
