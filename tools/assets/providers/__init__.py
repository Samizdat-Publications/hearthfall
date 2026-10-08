"""Provider clients. Each module is written from docs/research/asset_apis.md (section noted in its header)."""
from __future__ import annotations

import random
import time

import requests


class ProviderError(Exception):
    def __init__(self, provider: str, status, message: str, retryable: bool = False):
        super().__init__(f"{provider} HTTP {status}: {message}")
        self.provider = provider
        self.status = status
        self.message = message
        self.retryable = retryable


def http(provider: str, method: str, url: str, *, headers=None, json=None, params=None, files=None,
         data=None, timeout=60, retries=4, retry_5xx=False, stream=False):
    """requests wrapper: retries 429 (honoring Retry-After) and connect errors with backoff + jitter.

    5xx retry is opt-in (reads only): a create call that 5xx'd may already have been charged.
    Error text is truncated and never includes request headers, so keys cannot leak.
    """
    last = None
    for attempt in range(retries + 1):
        try:
            r = requests.request(method, url, headers=headers, json=json, params=params, files=files,
                                 data=data, timeout=timeout, stream=stream)
        except (requests.ConnectionError, requests.Timeout) as e:
            last = ProviderError(provider, None, type(e).__name__, retryable=True)
            if isinstance(e, requests.ReadTimeout) and not retry_5xx:
                raise last  # the request may have been processed; never blindly resend a paid call
            time.sleep(min(30, 2 ** attempt + random.random()))
            continue
        if r.status_code == 429 or (retry_5xx and r.status_code >= 500):
            ra = r.headers.get("Retry-After")
            try:
                wait = float(ra) if ra else 2 ** attempt + random.random()
            except ValueError:
                wait = 2 ** attempt + random.random()
            last = ProviderError(provider, r.status_code, r.text[:300], retryable=True)
            time.sleep(min(60, wait))
            continue
        if r.status_code >= 400:
            raise ProviderError(provider, r.status_code, r.text[:500])
        return r
    raise last or ProviderError(provider, None, "unknown failure")
