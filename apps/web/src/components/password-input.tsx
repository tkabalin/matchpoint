import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { ChangeEvent } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

type PasswordInputProps = {
  id: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  name?: string;
};

// Visibility is local, per-field state — every password field on a form (e.g.
// settings' current/new/confirm trio) toggles independently of the others.
export function PasswordInput({ id, value, onChange, autoComplete, name }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        name={name}
      />
      {/* has-[>button]:mr-1.5 overrides the addon's default has-[>button]:-mr-1 (which pulls
          an icon-only button flush into the corner) — a browser or password-manager
          extension renders its own icon overlay in that exact corner, so this toggle needs
          some clearance from it (#153), tightened close to the edge per #182 while still
          clearing that overlay. Re-targeting the same has-[>button]: variant is required: a
          plain mr-1.5 loses to -mr-1 on CSS specificity, since a :has() variant selector
          outranks a plain utility class regardless of source order. */}
      <InputGroupAddon align="inline-end" className="has-[>button]:mr-1.5">
        <InputGroupButton
          size="icon-sm"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
