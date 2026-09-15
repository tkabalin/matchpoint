---
paths:
  - apps/web/**
---

# UX Laws — MatchPoint Design Rule

Applies to every screen, component, and flow decision in MatchPoint. Before proposing or building
UI, check new work against these five laws. If a decision conflicts with one of them, name the
tradeoff explicitly rather than silently picking a side.

## 1. Pareto's Principle — build for the 20% that gets 80% of use

- Identify which action on a screen a coach will do most often, and make it the most prominent
  element. Everything else is secondary.
- Don't port a feature from a reference app (Strava, WHOOP, etc.) just because it exists there —
  only include it if it maps to something a MatchPoint coach actually does often. Match reference
  apps against MatchPoint's actual use case, not their full feature set.
- Low-frequency, high-necessity items (delete account, legal/support links) still belong — Pareto
  says minimize their visual weight, not omit them.

## 2. Hick's Law — fewer visible choices = faster decisions

- Group related options into named sections instead of one flat list. A screen with 15 ungrouped
  items is worse than the same 15 items in 4 labeled groups.
- Don't surface a setting/control until it's real. A stubbed-out placeholder with no function adds a
  decision with no payoff.
- When a flow branches, default to the common path and tuck the uncommon one behind one extra tap
  rather than presenting both options at equal weight up front.

## 3. Jakob's Law — match the mental model users already have

- Before inventing a new pattern, check how comparable apps solve the same problem (Strava, WHOOP,
  Notion, standard iOS/Android account settings) and default to that convention unless there's a
  specific reason to diverge.
- Identity data ("who am I") goes in a Profile-shaped surface; account/app configuration ("how does
  this behave for me") goes in a Settings-shaped surface. Don't blend the two mental models on one
  screen.
- Standard iconography and placement (gear = settings, avatar = profile, top-right = account
  controls) over novel ones, even if a custom icon looks nicer.

## 4. Fitts's Law — target size and distance should match the cost of a miss

- The most-used / highest-value action on a screen gets the largest, easiest-to-reach tap target.
- Destructive or irreversible actions (delete account, sign out of all sessions) get smaller
  targets, lighter visual weight, and a confirmation step scaled to severity (a plain confirm for
  "sign out all sessions"; confirm + typed verification for "delete account"). They should never sit
  flush against a similarly-worded safe action (e.g. "Sign out" vs "Sign out all sessions") — that
  adjacency with no separation is the failure mode to avoid, not a detail to gloss over.
- Do this separation within the same functional group, not by physically relocating an item to a
  different part of the page. Exiling "Sign out" to its own section at the bottom of the screen to
  protect it from "Sign out all sessions" breaks Jakob's Law (users expect all session/account
  actions in one place — Google, Slack, Notion all do this) without actually fixing the mis-tap
  risk. Separate them inside Account & Security instead, with extra distance between the two rows
  and graduated visual weight/confirmation friction: routine actions plain and easy, escalating
  actions behind more friction, most severe action lightest in weight but heaviest in confirmation.
  Distance is the variable this law is actually about, so widen the gap rather than drawing a rule
  between them — a divider line between two rows that already sit in a headed group reads as noise.
- Don't shrink or crowd a frequently-used control for aesthetic symmetry.

## 5. Miller's Law — chunk into groups of ~5–7 (comfortably 3–5 for touch UI)

- Any list longer than ~5-7 items needs subgrouping with clear section headers, not a longer scroll.
- Within a group, order items by actual frequency of use (tie back to Pareto), not alphabetically or
  by when they were built.
- If a new setting doesn't obviously belong to an existing group, that's a signal to either create a
  new group or reconsider whether the setting is needed at all (tie back to Hick's).

## Working rule of thumb

When adding anything new to Profile/Settings or any options-heavy screen:

- Does this belong on the 20% list, or is it a low-frequency tail item that should be visually
  deprioritized? (Pareto)
- Is it grouped with 4-6 related peers, not floating alone or crammed into an oversized list?
  (Hick's / Miller's)
- Would a coach coming from Strava/WHOOP/standard account settings find this where they expect it?
  (Jakob's)
- Is its tap target sized and placed appropriately for how often it's used and how costly a mis-tap
  would be? (Fitts's)
