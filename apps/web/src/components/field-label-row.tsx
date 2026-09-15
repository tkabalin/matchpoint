import { FieldLabel } from "@/components/ui/field";

/**
 * A field's label with a "(required)" or "(optional)" note beside it.
 *
 * Every field of a form carries one rather than only the required ones: a coach
 * filling in a player or a match shouldn't have to infer from an unmarked label
 * whether leaving it blank will cost them the submit. Leave `required` unset only
 * for a field where that distinction genuinely doesn't apply — one whose default
 * value already reads as "nothing chosen" (court type's "Unspecified"), so
 * calling it required or optional would both be misleading.
 *
 * The note sits outside the `<label>` on purpose, so it stays out of the input's
 * accessible name: "First name" is what a screen reader should announce for the
 * box, and the required fields say so again in their own error on submit.
 */
export function FieldLabelRow({
  htmlFor,
  required,
  className,
  children,
}: {
  htmlFor?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <FieldLabel htmlFor={htmlFor} className={className}>
        {children}
      </FieldLabel>
      {required !== undefined && (
        <span aria-hidden="true" className="text-xs font-normal text-muted-foreground">
          ({required ? "required" : "optional"})
        </span>
      )}
    </div>
  );
}
