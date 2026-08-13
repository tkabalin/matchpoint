# Security

Cross-cutting security policy. The mechanisms themselves (Argon2id parameters, opaque session
tokens, the rate limiter, transactional email) are documented in [tech-stack.md](tech-stack.md);
this page records the policy that spans them.

## Account enumeration

**The risk.** Whether an email address has an account here tells a prober that a given person is a
coach on this platform, and narrows a credential-stuffing run from the address space to the
membership.

**The policy.** Every endpoint that takes an email from an unauthenticated caller answers known and
unknown addresses identically: same status code, same body, same rate-limit behaviour. New
authentication endpoints are built to this policy.

**The one exception: sign-up.** The sign-up entry point answers "Email already registered" openly.

- A form that cannot say "you already have an account, sign in instead" tests badly, and
  low-friction setup is a priority of the brief.
- The cost is metered rather than closed: the per-email rate limit charges a probe of a registered
  address exactly as it charges a code request.

**How each path holds it:**

- **Login:** one message for an unknown email and a wrong password; a dummy Argon2 verification, so
  response time does not answer what the body refuses to; a wrong-guess budget keyed on the
  submitted address whether or not an account lives there.
- **Password reset:** a uniform 202 whether or not the address holds an account.
- **Code redemption** (sign-up verification and reset codes): every failure collapses into one
  response.

**Accepted residual channels.** In the reset flow, a request for a registered address takes
measurably longer (it stores a code and sends an email), and a send failure answers 502 only for a
registered address. Both reveal nothing the sign-up entry does not already answer openly.
