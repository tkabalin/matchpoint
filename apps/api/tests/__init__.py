"""The API test suite — and the one place that can keep it off a third party.

Here rather than in a `conftest.py` fixture because of when it has to happen: pytest
imports this package before any fixture runs, and test modules build an app — and so a
sender and a breach checker — at import time. Without the email pin, a machine set up for
a real send (see infra/prod/README.md) would fire the suite's `@example.com` addresses at
the provider, which rejects them with a 422 that reads like a bad key. The breach pin has
no such backstop: the corpus lookup needs no key, so a fresh checkout would reach Have I
Been Pwned on every password the suite chooses and nothing would say so.

The media root is pinned here for the same "before any fixture" reason rather than for
that one: `create_app` creates the directory it serves photos from, so without a pin the
mere import of a test module would leave one in the working tree. `conftest.py` narrows
it to a directory per test on top of this.

`.claude/rules/api-tests.md` keeps both as one invariant, including why the email
addresses must stay unroutable rather than be repointed at a provider sink.
"""

import tempfile
from pathlib import Path

from matchpoint_api.config import settings

settings.email_sender = "logging"
settings.breach_checker = "allow_all"
settings.media_root = Path(tempfile.mkdtemp(prefix="matchpoint-test-media-"))
