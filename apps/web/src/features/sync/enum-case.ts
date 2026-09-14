/**
 * The wire's casing convention for every enum this slice sends: lowercase.
 * Shared by point-payload.ts and checkpoint-payload.ts rather than each holding
 * its own copy — `Lowercase<T>` is what lets one helper carry every member and
 * still be checked: `Lowercase<"DOUBLE_FAULT">` is the literal "double_fault", so
 * a member the API lacks fails to type against the generated request shape.
 */

export function lower<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

export function lowerOrNull<T extends string>(value: T | null): Lowercase<T> | null {
  return value === null ? null : lower(value);
}
