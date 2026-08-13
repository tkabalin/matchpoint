"""The API test suite — and the one place that can keep it off a real email provider.

Here rather than in a `conftest.py` fixture because of when it has to happen: pytest
imports this package before any fixture runs, and test modules build an app — and so a
sender — at import time. Without the pin, a machine set up for a real send (see
infra/prod/README.md) would fire the suite's `@example.com` addresses at the provider,
which rejects them with a 422 that reads like a bad key.

`.claude/rules/api-tests.md` keeps this as an invariant, including why those addresses
must stay unroutable rather than be repointed at a provider sink.
"""

from matchpoint_api.config import settings

settings.email_sender = "logging"
