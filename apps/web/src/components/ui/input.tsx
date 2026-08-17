import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

// rounded-4xl is kept in sync with InputGroup's and Button's own base radius by hand —
// nothing ties these three literal classes together (rounded-3xl/4xl are genuinely
// different values in app.css, not aliases), so a future edit to one needs the other two
// checked too (#152).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-4xl border border-transparent bg-input/50 px-3 py-1 text-base transition-[color,box-shadow,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 autofill:shadow-[inset_0_0_0_1000px_var(--color-input)] autofill:[-webkit-text-fill-color:var(--color-foreground)] autofill:[caret-color:var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
