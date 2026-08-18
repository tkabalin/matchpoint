"""What the two transactional emails say, in both parts a mail client can render.

The HTML is hand-authored here rather than rendered from React components in `apps/web`,
so a wording change is one edit in the language that sends the mail, with no build step
and no generated file to fall out of step with it. Table layout and inline styles because
Outlook and Gmail strip most of the rest; the `<style>` block only carries the dark-mode
overrides, which are the one thing an inline style cannot express.
"""

from dataclasses import dataclass
from datetime import timedelta
from html import escape
from string import Template

# No support link and no unsubscribe: this is transactional mail a coach asked for by
# tapping a button, and mail.py's From address takes no replies.
_FOOTER = "MatchPoint, tennis statistics for coaches. This is an automated message."

# The two blues are the nav/brand tokens from .claude/rules/web-color.md, light and dark.
# Brand chrome is the one role that rule allows blue, so they dress the header band and
# nothing else: the code is content, and stays near-black on a neutral panel.
_LAYOUT = Template("""<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>$title</title>
<style>
@media (prefers-color-scheme: dark) {
  .mp-body { background-color: #0F1417 !important; }
  .mp-page { background-color: #0F1417 !important; }
  .mp-card { background-color: #171E23 !important; border-color: #2C363D !important; }
  .mp-band { background-color: #1E88C7 !important; }
  .mp-panel { background-color: #0F1417 !important; border-color: #2C363D !important; }
  .mp-text { color: #E7ECEF !important; }
  .mp-muted { color: #A8B3BA !important; }
}
</style>
</head>
<body class="mp-body" style="margin:0;padding:0;background-color:#EDF1F4;">
<div lang="en" dir="ltr">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;
            font-size:1px;line-height:1px;color:#EDF1F4;">$preheader
  &#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;
</div>
<table role="presentation" class="mp-page" width="100%" cellpadding="0" cellspacing="0"
       border="0" style="background-color:#EDF1F4;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" class="mp-card" width="600" cellpadding="0" cellspacing="0"
             border="0"
             style="max-width:600px;width:100%;background-color:#FFFFFF;
                    border:1px solid #DDE3E7;border-radius:4px;
                    font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;">
        <tr>
          <td class="mp-band" style="background-color:#045C8C;padding:20px 32px;">
            <span style="color:#FFFFFF;font-size:20px;line-height:26px;font-weight:700;
                         letter-spacing:0.5px;">MatchPoint</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 class="mp-text"
                style="margin:0 0 12px;font-size:22px;line-height:28px;font-weight:600;
                       color:#14181B;">$heading</h1>
            <p class="mp-text"
               style="margin:0 0 24px;font-size:16px;line-height:24px;color:#14181B;">$intro</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="mp-panel" align="center"
                    style="background-color:#F3F6F8;border:1px solid #DDE3E7;
                           border-radius:4px;padding:20px 12px;">
                  <span class="mp-text"
                        style="font-family:Consolas,'Liberation Mono',Menlo,monospace;
                               font-size:32px;line-height:40px;font-weight:700;
                               letter-spacing:6px;color:#14181B;">$code</span>
                </td>
              </tr>
            </table>
            <p class="mp-muted"
               style="margin:24px 0 0;font-size:14px;line-height:20px;color:#5A656C;">$expiry</p>
            <p class="mp-muted"
               style="margin:12px 0 0;font-size:14px;line-height:20px;color:#5A656C;">$note</p>
          </td>
        </tr>
      </table>
      <p class="mp-muted"
         style="margin:16px 0 0;max-width:600px;font-size:12px;line-height:18px;color:#5A656C;
                font-family:Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;">$footer</p>
    </td>
  </tr>
</table>
</div>
</body>
</html>
""")


@dataclass(frozen=True)
class Message:
    """One email, in the parts `EmailSender.send` needs to post it.

    Subject and body travel together because the two bodies must say the same thing: a
    caller that assembled one of them itself would be free to drift from the other.
    """

    subject: str
    text: str
    html: str


def signup_code(*, code: str, expires_in: timedelta) -> Message:
    """The code that proves a sign-up address before an account is created."""
    return _code_message(
        subject="Your MatchPoint sign-up code",
        heading="Confirm your email address",
        intro="Enter this code in MatchPoint to finish creating your account.",
        note="If you didn't try to create a MatchPoint account, you can ignore this email.",
        code=code,
        expires_in=expires_in,
    )


def password_reset_code(*, code: str, expires_in: timedelta) -> Message:
    """The code that lets a coach who has lost their password choose a new one."""
    return _code_message(
        subject="Your MatchPoint password reset code",
        heading="Reset your password",
        intro="Enter this code in MatchPoint to choose a new password.",
        note=(
            "If you didn't ask to reset your password, you can ignore this email. "
            "Your password stays as it is."
        ),
        code=code,
        expires_in=expires_in,
    )


def _code_message(
    *,
    subject: str,
    heading: str,
    intro: str,
    note: str,
    code: str,
    expires_in: timedelta,
) -> Message:
    """Dress one six-digit code as both halves of a multipart message.

    Both emails are the same email with different words, so the layout is shared and the
    wording is not. The plain-text half mirrors the HTML block for block, which is what
    keeps a client that renders neither, or only one, showing the same message.
    """
    expiry = f"This code expires in {int(expires_in.total_seconds()) // 60} minutes."
    text = f"{intro}\n\n{code}\n\n{expiry}\n\n{note}\n\n{_FOOTER}\n"
    fields = {
        # The subject doubles as the <title>, which several clients and screen readers
        # read out before anything else.
        "title": subject,
        # Reinforcing the subject in the inbox preview line, under the ~90 characters a
        # client will show of it.
        "preheader": f"{intro} {expiry}",
        "heading": heading,
        "intro": intro,
        "code": code,
        "expiry": expiry,
        "note": note,
        "footer": _FOOTER,
    }
    # Every hole in the layout is a text node, never an attribute, so quotes need no
    # escaping and apostrophes stay readable in the source. The codes are digits today;
    # escaping is what keeps that from being a rule a later caller has to know.
    html = _LAYOUT.substitute({name: escape(value, quote=False) for name, value in fields.items()})
    return Message(subject=subject, text=text, html=html)
