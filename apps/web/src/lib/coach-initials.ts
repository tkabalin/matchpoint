/** "Jamie Chen" → "JC"; one name → its first letter. A coach has one display_name,
 * not first/last, so this can't reuse PlayerAvatar's split. Shared by Profile's own
 * avatar and Home's header avatar (#179). */
export function initialsFor(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
