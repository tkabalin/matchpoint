import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The file scripts/e2e-api.sh points the API's "file" email sender at: one line of JSON
// per message it would have sent (apps/api/src/matchpoint_api/mail.py). Reading the code
// out of it is what lets a spec finish a real sign-up against a live API.
const MAIL_FILE = fileURLToPath(new URL(".mail.jsonl", import.meta.url));

type Message = { to: string; subject: string; text: string };

/**
 * The six-digit code the API last sent to `email`.
 *
 * Read once rather than polled: the API writes the message before it answers the request
 * that asked for it, so by the time the form has moved on the line is already on disk.
 */
export function readVerificationCode(email: string): string {
  const messages = readFileSync(MAIL_FILE, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Message)
    .filter((message) => message.to === email);
  // The last one, not the only one: requesting a fresh code leaves the spent one above it.
  const code = messages.at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
  if (code === undefined) {
    throw new Error(`No verification code was sent to ${email} (looked in ${MAIL_FILE})`);
  }
  return code;
}
