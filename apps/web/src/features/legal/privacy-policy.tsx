import { LegalPage } from "./legal-page";

/**
 * Plumbing only (#194) — the real text needs sourcing from BBD or the course
 * convener before it ships (see the MR description for why), not written
 * here. This placeholder exists so the route, the link from Settings, and
 * the link from sign-up all have somewhere real to point today.
 */
export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        MatchPoint&apos;s privacy policy is being finalised and will appear here soon. It will
        explain what player and match data the app collects, how it is stored, and how to have it
        removed.
      </p>
    </LegalPage>
  );
}
