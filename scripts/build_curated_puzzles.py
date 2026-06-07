"""Build three curated static puzzles and emit puzzles.json entries.

Run from the project root:

    python scripts/build_curated_puzzles.py

The script:
1. Predicts the native structure for each candidate (cached after first run).
2. Builds the hand-designed broken starter.
3. Predicts the broken starter and computes baseline RMSD.
4. Runs the same gradient validator the generator uses.
5. If the validator passes, writes ``backend/data/targets/<file>.pdb`` and
   prints the puzzles.json entry to stdout so it can be merged manually.

Hand-picked breaker recipes were chosen so each puzzle teaches something
different from the existing two: Trp-cage demonstrates the hydrophobic core
+ a Pro-stabilised turn; Engrailed homeodomain (3-helix bundle) demonstrates
cooperative inter-helix packing; HP35 alt-breaker shows that the same
protein has many valid "broken" starting points.
"""

import io
import json
import sys
from dataclasses import dataclass
from pathlib import Path

# Make the project root importable regardless of where the script is run from.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")  # Windows console safety

from backend.config import settings  # noqa: E402
from backend.services.esmfold_client import predict_pdb  # noqa: E402
from backend.services.puzzle_validator import validate_puzzle  # noqa: E402
from backend.services.scoring import ca_coords_from_pdb, kabsch_rmsd  # noqa: E402
from backend.services.structure_cache import (  # noqa: E402
    StructureCache,
    mean_plddt_from_pdb,
)


@dataclass
class CuratedSpec:
    id: str
    title: str
    description: str
    native_sequence: str
    breaker_positions: list[int]   # 0-indexed
    breaker_substitutions: list[str]  # parallel to breaker_positions
    mutation_budget: int
    expected_solved_rmsd: float
    hint: str
    difficulty: str
    target_pdb_file: str


CANDIDATES: list[CuratedSpec] = [
    # ---------------- Trp-cage rescue ----------------
    # Native miniprotein (PDB 1L2Y) — 20 aa, NMR. The Trp at position 5 (0-idx)
    # forms the hydrophobic core; Pro12 and the Pro17/18/19 cluster lock the cage.
    # Breakers: kill the core Trp and loosen the cage by swapping a key Pro.
    CuratedSpec(
        id="puzzle3",
        title="Cage the Trp",
        description=(
            "Trp-cage (PDB 1L2Y) is the smallest fast-folding miniprotein known, "
            "with a single tryptophan locked inside a polyproline cage. Three "
            "mutations have killed the hydrophobic core. Restore the cage."
        ),
        native_sequence="NLYIQWLKDGGPSSGRPPPS",
        # W6 (core tryptophan), P12 (turn-stabilising), P19 (cage closing)
        breaker_positions=[5, 11, 18],
        breaker_substitutions=["A", "A", "A"],
        mutation_budget=4,
        expected_solved_rmsd=1.2,
        hint=(
            "The tryptophan at position 6 (W) sits in the centre of the cage. "
            "The prolines at 12 and 19 hold the polyproline loop together."
        ),
        difficulty="easy",
        target_pdb_file="puzzle3_trpcage.pdb",
    ),
    # ---------------- HP35 core-strike ("Crack the Core") ----------------
    # Same 36 aa HP35 native as puzzle2 but the breakers target the hydrophobic
    # CORE residues instead of helix-favouring ones. ESMFold's prior on HP35
    # is strong enough that P/G-only edits leave the native fold intact; we
    # have to hit the core (F, V, W, L) with charge swaps to actually unfold it.
    CuratedSpec(
        id="puzzle4",
        title="Crack the Core",
        description=(
            "HP35 (villin headpiece) again — but this time the breakers killed "
            "the hydrophobic core, not the helices. Phe and Trp swapped for "
            "charged residues. Restore the core so the bundle can pack."
        ),
        native_sequence="MLSDEDFKAVFGMTRSAFANLPLWKQQNLKKEKGLF",
        # Native:   M L S D E D F K A V  F  G  M  T  R  S  A  F  A  N  L  P  L  W  K  Q  Q  N  L  K  K  E  K  G  L  F
        # pos:      0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35
        # Hit the core hydrophobics:
        #   F6  → E (helix 1 core)
        #   V9  → P (helix 1 break + small AA)
        #   F17 → K (helix 2 core)
        #   W23 → E (Trp pi-stacker)
        #   L28 → G (helix 3 break)
        #   L34 → D (C-cap hydrophobic)
        breaker_positions=[6, 9, 17, 23, 28, 34],
        breaker_substitutions=["E", "P", "K", "E", "G", "D"],
        mutation_budget=8,
        expected_solved_rmsd=1.5,
        hint=(
            "Charged residues (D, E, K) don't belong in a hydrophobic core. "
            "Trp (W) and Phe (F) are big aromatics that hold the core together. "
            "Helix-breaking Pro and Gly also need to go."
        ),
        difficulty="medium",
        target_pdb_file="puzzle4_hp35_core.pdb",
    ),
    # ---------------- GB1 hairpin (β-only) ----------------
    # The 16-residue β-hairpin from protein G B1 domain — the same template
    # the procedural generator uses, but a hand-curated static puzzle so
    # there's a deterministic β-only solve in the catalog (everything else
    # is helical or cage). Hits the two core aromatics (W2, F11) plus the
    # branched V13 to actually unfold the strand.
    CuratedSpec(
        id="puzzle6",
        title="Hairpin Lost",
        description=(
            "The GB1 β-hairpin (PDB 2GB1 residues 41-56) is one of the "
            "smallest, fastest-folding β-sheet motifs known. Five core "
            "residues have been swapped for charge or helix-breakers and "
            "the hairpin has unwound. Restore the strand pairing."
        ),
        native_sequence="GEWTYDDATKTFTVTE",
        # Native:  G E W T Y D D A T K T  F  T  V  T  E
        # pos:     0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
        # W2  → K (charge in the strand 1 aromatic anchor)
        # Y4  → D (charge into the second strand 1 aromatic)
        # F11 → K (charge in the strand 2 aromatic anchor)
        # V13 → P (helix-breaker right where a β-branched residue belongs)
        # T14 → A (kill β-propensity on strand 2)
        breaker_positions=[2, 4, 11, 13, 14],
        breaker_substitutions=["K", "D", "K", "P", "A"],
        mutation_budget=6,
        expected_solved_rmsd=1.6,
        hint=(
            "β-strands love branched/aromatic residues: V, I, T, W, Y, F. "
            "Charged residues (K, D, E) and the helix-breaker Pro don't pair "
            "into sheets. The DDA at positions 6-8 is the turn — leave it alone."
        ),
        difficulty="easy",
        target_pdb_file="puzzle6_gb1.pdb",
    ),
    # ---------------- GCN4 leucine zipper (coiled-coil) ----------------
    # Same sequence + breaker recipe as the gcn4-coil template's hard tier,
    # frozen as a static catalog entry so first-time players see the
    # coiled-coil mechanic without going through the "+ New puzzle" modal.
    CuratedSpec(
        id="puzzle7",
        title="Zipper Down",
        description=(
            "GCN4-p1 leucine zipper (yeast transcription factor coiled-coil). "
            "As a single chain ESMFold predicts a clean α-helix held together "
            "by buried Leucines at every 7th position. Six Leucines (4 core + "
            "2 surface) have been swapped — some for the helix-breaker Pro, "
            "some for charged Glu — and the helix has unwound."
        ),
        native_sequence="RMKQLEDKVEELLSKNYHLENEVARLKKLVGER",
        # Native:  R M K Q L E D K V E  E  L  L  S  K  N  Y  H  L  E  N  E  V  A  R  L  K  K  L  V  G  E  R
        # pos:     0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32
        # L4  → P (helix-breaker right at the N-cap of the spine)
        # L11 → E (charge into the core)
        # L12 → E (surface, but still wrong)
        # L18 → E (core)
        # L25 → P (helix-breaker mid-chain)
        # L28 → E (surface)
        breaker_positions=[4, 11, 12, 18, 25, 28],
        breaker_substitutions=["P", "E", "E", "E", "P", "E"],
        mutation_budget=7,
        expected_solved_rmsd=1.8,
        hint=(
            "Coiled-coils pack their hydrophobic core every 7th residue "
            "(heptad-d). Buried Leucines were swapped for charged Glu or for "
            "the helix-breaker Pro. Find the L→E and L→P swaps and revert."
        ),
        difficulty="hard",
        target_pdb_file="puzzle7_gcn4.pdb",
    ),
    # ---------------- Engrailed homeodomain ----------------
    # 1ENH-style 56 aa 3-helix bundle. Like HP35, ESMFold's prior is strong on
    # this scaffold — gentle helix-breakers leave it nearly intact. We hit the
    # hydrophobic core (Phe, Tyr, Leu, Ile) one per helix, plus a P/G break.
    CuratedSpec(
        id="puzzle5",
        title="Three-helix Bundle",
        description=(
            "A 56-residue 3-helix bundle DNA-binding motif (Engrailed "
            "homeodomain family). Five mutations have wrecked the inter-helix "
            "packing — hydrophobic core residues swapped for polar/charged "
            "ones. Restore the packing so the three helices can pack together."
        ),
        native_sequence="EKRPRTAFSSEQLARLKREFNENRYLTERRRQQLSSELGLNEAQKISRWFQNRRAK",
        # Native:  E K R P R T A F S S  E  Q  L  A  R  L  K  R  E  F  N  E  N  R  Y  L  T  E  R  R  R  Q  Q  L  S  S  E  L  G  L  N  E  A  Q  K  I  S  R  W  F  Q  N  R  R  A  K
        # pos:     0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55
        #                            ^helix 1 (~9-19)              ^helix 2 (~26-35)         ^helix 3 (~41-53)
        # F7  → D (N-cap aromatic → acidic; killed)
        # F19 → E (helix 1 core)
        # Y24 → K (helix 2 core)
        # I45 → P (helix 3 core + break)
        # W49 → E (helix 3 core Trp)
        breaker_positions=[7, 19, 24, 45, 49],
        breaker_substitutions=["D", "E", "K", "P", "E"],
        mutation_budget=7,
        expected_solved_rmsd=2.0,
        hint=(
            "Hydrophobic cores need hydrophobic residues. F (Phe), Y (Tyr), "
            "W (Trp), I (Ile), L (Leu), V (Val) are the usual core residues. "
            "Charged residues (D, E, K, R) don't belong in the centre."
        ),
        difficulty="medium",
        target_pdb_file="puzzle5_engrailed.pdb",
    ),
]


def main() -> int:
    cache = StructureCache(settings.cache_db_path)

    def predict_fn(seq: str) -> tuple[str, float]:
        cached = cache.get(seq)
        if cached is not None:
            return cached[0], 0.0
        pdb, elapsed = predict_pdb(seq)
        cache.put(seq, pdb, mean_plddt_from_pdb(pdb))
        return pdb, elapsed

    targets_dir = ROOT / "backend" / "data" / "targets"
    targets_dir.mkdir(parents=True, exist_ok=True)

    accepted: dict[str, dict] = {}

    for spec in CANDIDATES:
        print(f"\n=== {spec.id}: {spec.title} ===")
        print(f"  native ({len(spec.native_sequence)} aa): {spec.native_sequence}")

        # Build broken starter from native + recipe.
        starter = list(spec.native_sequence)
        for pos, aa in zip(spec.breaker_positions, spec.breaker_substitutions):
            starter[pos] = aa
        starter_seq = "".join(starter)
        print(f"  starter:                   {starter_seq}")
        print(f"  breakers: {list(zip(spec.breaker_positions, spec.breaker_substitutions))}")

        # Predict native + broken.
        print(f"  predicting native...")
        native_pdb, t_native = predict_fn(spec.native_sequence)
        native_plddt = mean_plddt_from_pdb(native_pdb)
        print(f"    elapsed {t_native:.2f}s | mean pLDDT {native_plddt:.3f}")

        print(f"  predicting starter...")
        starter_pdb, t_starter = predict_fn(starter_seq)
        starter_plddt = mean_plddt_from_pdb(starter_pdb)
        print(f"    elapsed {t_starter:.2f}s | mean pLDDT {starter_plddt:.3f}")

        baseline_rmsd = float(kabsch_rmsd(
            ca_coords_from_pdb(starter_pdb),
            ca_coords_from_pdb(native_pdb),
        ))
        print(f"  baseline RMSD: {baseline_rmsd:.2f} A")

        # Validate.
        result = validate_puzzle(
            starter_seq=starter_seq,
            original_seq=spec.native_sequence,
            target_pdb=native_pdb,
            mutation_budget=spec.mutation_budget,
            expected_solved_rmsd=spec.expected_solved_rmsd,
            baseline_rmsd=baseline_rmsd,
            starter_plddt=starter_plddt,
            predict_fn=predict_fn,
        )
        print(f"  validator: passes={result.passes}, reason={result.reason!r}")
        ep_r = f"{result.endpoint_rmsd:.2f}" if result.endpoint_rmsd is not None else "n/a"
        ep_p = f"{result.endpoint_plddt:.2f}" if result.endpoint_plddt is not None else "n/a"
        print(f"    endpoint RMSD {ep_r} A | pLDDT {ep_p}")
        print(f"    helpful reverts: {result.helpful_reverts}/{result.total_reverts_tried}")
        for p in result.probes:
            flag = "+" if p.helpful else " "
            pp = f"{p.plddt_mean:.2f}" if p.plddt_mean is not None else "n/a"
            print(f"      {flag} pos {p.position+1:3d} {p.from_aa}->{p.to_aa}: RMSD {p.rmsd:.2f} (delta {p.delta_rmsd:+.2f}) pLDDT {pp}")

        if not result.passes:
            print(f"  REJECTED — fix the recipe and re-run")
            continue

        # Save target PDB.
        target_path = targets_dir / spec.target_pdb_file
        target_path.write_text(native_pdb, encoding="utf-8")
        print(f"  saved target -> {target_path}")

        # Build puzzles.json entry.
        accepted[spec.id] = {
            "id": spec.id,
            "title": spec.title,
            "description": spec.description,
            "starting_sequence": starter_seq,
            "target_pdb_file": spec.target_pdb_file,
            "mutation_budget": spec.mutation_budget,
            "baseline_rmsd": round(baseline_rmsd, 2),
            "expected_solved_rmsd": spec.expected_solved_rmsd,
            "hint": spec.hint,
            "difficulty": spec.difficulty,
        }

    print(f"\n\n=== Accepted: {len(accepted)}/{len(CANDIDATES)} ===")
    print(json.dumps(accepted, indent=2, ensure_ascii=False))
    return 0 if accepted else 1


if __name__ == "__main__":
    sys.exit(main())
