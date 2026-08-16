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
};

// Visibility is local, per-field state — every password field on a form (e.g.
// settings' current/new/confirm trio) toggles independently of the others.
export function PasswordInput({ id, value, onChange }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
      />
      <InputGroupAddon align="inline-end">
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
