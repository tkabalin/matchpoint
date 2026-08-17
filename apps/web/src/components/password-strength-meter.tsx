import { interpolateSeverityColor } from "@/lib/color-scale";

const LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];

// Fill color progresses with the score via interpolateSeverityColor (a sequential
// scale, not the categorical rainbow palette in .claude/rules/web-color.md — see its
// "Sequential / severity scale" section, and docs/color-palette.md, for why). The text
// label is this meter's non-color channel, standing in for the pattern overlay a
// discrete categorical swatch would use — a thin fill has no room for a pattern.
export function PasswordStrengthMeter({ score }: { score: number }) {
  const label = LABELS[score] ?? LABELS[0];

  return (
    <div>
      <div className="h-1 w-full max-w-64 rounded-full bg-muted">
        <div
          className="h-1 rounded-full transition-all"
          style={{
            width: `${((score + 1) / LABELS.length) * 100}%`,
            backgroundColor: interpolateSeverityColor(score / (LABELS.length - 1)),
          }}
        />
      </div>
      <p>{label}</p>
    </div>
  );
}
