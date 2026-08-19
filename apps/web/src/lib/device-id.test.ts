import { afterEach, expect, test, vi } from "vitest";

import { getDeviceId } from "./device-id";

const STORAGE_KEY = "matchpoint:device-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("mints a uuid on first access and persists it", () => {
  const deviceId = getDeviceId();

  // The server takes the id as a UUID, so a value it would reject is a broken claim.
  expect(deviceId).toMatch(UUID);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(deviceId);
});

test("returns the same id on later access, without minting again", () => {
  const randomUUID = vi.spyOn(crypto, "randomUUID");

  const first = getDeviceId();
  const second = getDeviceId();

  expect(second).toBe(first);
  expect(randomUUID).toHaveBeenCalledOnce();
});

test("returns an id stored by an earlier visit", () => {
  const randomUUID = vi.spyOn(crypto, "randomUUID");
  localStorage.setItem(STORAGE_KEY, "b0f4c0de-1111-4222-8333-444455556666");

  expect(getDeviceId()).toBe("b0f4c0de-1111-4222-8333-444455556666");
  expect(randomUUID).not.toHaveBeenCalled();
});
