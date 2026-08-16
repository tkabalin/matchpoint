const LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];

// Fill width by score alone, not a distinct hue per step — this is one ordinal
// quantity, not a set of categories, so the categorical rainbow palette in
// .claude/rules/web-color.md doesn't apply here (see docs/color-palette.md).
export function PasswordStrengthMeter({ score }: { score: number }) {
  const label = LABELS[score] ?? LABELS[0];

  return (
    <div>
      <div className="h-1 w-full max-w-64 rounded-full bg-muted">
        <div
          className="h-1 rounded-full bg-foreground transition-all"
          style={{ width: `${((score + 1) / LABELS.length) * 100}%` }}
        />
      </div>
      <p>{label}</p>
    </div>
  );
}
