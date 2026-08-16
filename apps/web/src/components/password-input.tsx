import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { ChangeEvent } from "react";

import { Button } from "@/components/ui/button";

type PasswordInputProps = {
  id: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

// Visibility is local, per-field state — every password field on a form (e.g.
// settings' current/new/confirm trio) toggles independently of the others.
export function PasswordInput({ id, value, onChange }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="inline-flex items-center gap-1">
      <input id={id} type={visible ? "text" : "password"} value={value} onChange={onChange} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </span>
  );
}
