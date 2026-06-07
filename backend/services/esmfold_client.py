"""Thin wrapper around the ESM Atlas public API.

Returns raw PDB text. Retries on 429/5xx with exponential backoff.
Designed so swapping to HuggingFace Inference API later is a one-file change.
"""

import logging
import time

import requests

from backend.config import settings

log = logging.getLogger(__name__)


class ESMFoldError(RuntimeError):
    """Raised when ESM Atlas returns an unrecoverable error or invalid PDB."""


def predict_pdb(sequence: str) -> tuple[str, float]:
    """Call ESM Atlas. Returns (pdb_text, elapsed_seconds).

    Retries up to settings.max_retries on 429 / 5xx with exponential backoff.
    """
    last_err: Exception | None = None
    for attempt in range(1, settings.max_retries + 1):
        try:
            t0 = time.perf_counter()
            resp = requests.post(
                settings.esm_atlas_url,
                data=sequence,
                headers={"Content-Type": "text/plain"},
                timeout=settings.request_timeout_s,
            )
            elapsed = time.perf_counter() - t0

            if resp.status_code == 200:
                pdb = resp.text
                if not pdb.lstrip().startswith(("HEADER", "ATOM", "MODEL")):
                    raise ESMFoldError(f"Response is not a PDB: {pdb[:120]!r}")
                log.info("predict ok len=%d attempt=%d elapsed=%.2fs", len(sequence), attempt, elapsed)
                return pdb, elapsed

            if resp.status_code in (429, 500, 502, 503, 504):
                last_err = ESMFoldError(f"HTTP {resp.status_code}: {resp.text[:120]}")
                delay = settings.retry_base_delay_s * (2 ** (attempt - 1))
                log.warning("predict transient HTTP %d (attempt %d/%d), sleeping %.1fs",
                            resp.status_code, attempt, settings.max_retries, delay)
                time.sleep(delay)
                continue

            raise ESMFoldError(f"HTTP {resp.status_code}: {resp.text[:200]}")

        except requests.RequestException as e:
            last_err = e
            delay = settings.retry_base_delay_s * (2 ** (attempt - 1))
            log.warning("predict network error (attempt %d/%d): %s — sleeping %.1fs",
                        attempt, settings.max_retries, e, delay)
            time.sleep(delay)

    raise ESMFoldError(f"All {settings.max_retries} attempts failed: {last_err}")
