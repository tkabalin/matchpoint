import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A read-only code plus a copy button — promoted here once a second caller
 *  needed it (#219): the player transfer-code reveal (`edit-player-sheet.tsx`)
 *  and the new-player credentials reveal both show a value that is shown once
 *  and never retrievable again. */
export function CopyCodeField({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={code} aria-label={label} className="font-mono" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={copied ? "Copied" : "Copy code"}
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
      <span className="sr-only" role="status">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
