"""Day 1 spike: call ESMFold via the ESM Atlas public API and save a PDB.

Goal: prove we can go from a sequence string to a renderable PDB file
without any auth tokens. If this works, the v1 backend can wrap it.
"""

import sys
import time
from pathlib import Path

import requests

ESM_ATLAS_URL = "https://api.esmatlas.com/foldSequence/v1/pdb/"

# Trp-cage miniprotein (20 aa, PDB 1L2Y) — well-characterized fast folder,
# good sanity check because the predicted structure should be a clear
# helix + small hydrophobic core.
TEST_SEQUENCE = "NLYIQWLKDGGPSSGRPPPS"


def predict(sequence: str, timeout: int = 60) -> str:
    """POST a sequence, return PDB text. Raises on non-200."""
    t0 = time.perf_counter()
    resp = requests.post(
        ESM_ATLAS_URL,
        data=sequence,
        headers={"Content-Type": "text/plain"},
        timeout=timeout,
        verify=True,
    )
    elapsed = time.perf_counter() - t0
    print(f"  HTTP {resp.status_code} in {elapsed:.2f}s")
    resp.raise_for_status()
    return resp.text


def main() -> int:
    sequence = sys.argv[1] if len(sys.argv) > 1 else TEST_SEQUENCE
    print(f"Sequence ({len(sequence)} aa): {sequence}")

    try:
        pdb = predict(sequence)
    except requests.HTTPError as e:
        print(f"FAIL: {e}")
        print(f"Body: {e.response.text[:500]}")
        return 1
    except requests.RequestException as e:
        print(f"FAIL: {e}")
        return 1

    if not pdb.lstrip().startswith(("HEADER", "ATOM", "MODEL")):
        print("FAIL: response does not look like a PDB file")
        print(f"First 200 chars: {pdb[:200]}")
        return 1

    out = Path(__file__).parent / "predicted.pdb"
    out.write_text(pdb)
    atom_lines = sum(1 for ln in pdb.splitlines() if ln.startswith("ATOM"))
    print(f"OK: wrote {out.name} ({len(pdb)} bytes, {atom_lines} ATOM lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
