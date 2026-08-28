import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { PhotoPickerSheet } from "./photo-picker-sheet";

test("offers Remove photo only when one is set", () => {
  const { rerender } = render(
    <PhotoPickerSheet
      open
      onOpenChange={vi.fn()}
      hasPhoto={false}
      onChoose={vi.fn()}
      onRemove={vi.fn()}
    />,
  );

  expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();

  rerender(
    <PhotoPickerSheet open onOpenChange={vi.fn()} hasPhoto onChoose={vi.fn()} onRemove={vi.fn()} />,
  );

  expect(screen.getByRole("button", { name: "Remove photo" })).toBeInTheDocument();
});

test("Choose photo opens the file picker, and a picked file reaches onChoose", async () => {
  const onChoose = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(
    <PhotoPickerSheet
      open
      onOpenChange={vi.fn()}
      hasPhoto={false}
      onChoose={onChoose}
      onRemove={vi.fn()}
    />,
  );

  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);

  expect(onChoose).toHaveBeenCalledWith(file);
});

test("Remove photo calls onRemove", async () => {
  const onRemove = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(
    <PhotoPickerSheet
      open
      onOpenChange={vi.fn()}
      hasPhoto
      onChoose={vi.fn()}
      onRemove={onRemove}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Remove photo" }));

  expect(onRemove).toHaveBeenCalledOnce();
});

test("Cancel closes the sheet without choosing or removing anything", async () => {
  const onOpenChange = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(
    <PhotoPickerSheet
      open
      onOpenChange={onOpenChange}
      hasPhoto
      onChoose={vi.fn()}
      onRemove={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
});
