# G1 reproduction record: pinned `main` at `afdf390`

Gate G1 of the [ground-truth register](GROUND_TRUTH_REGISTER_2026-10-20.md). This record reproduces
the archived offline evidence on a different platform. It does not claim anything about model
behaviour. The machine-readable record is
[`evals/evidence/g1-reproduction-2026-10-20/`](../../evals/evidence/g1-reproduction-2026-10-20/checks.json).

**Source.** `afdf39019ae2472b49b6ea6380bede690cf287a3`: the `main` head the register names, checked
out unmodified before any change on this branch.

**Environment.** Linux x86_64 cloud container, Node v22.22.0, Python 3.13.16, inspect_ai 0.3.282.
Hosted CI pins Windows, Node 24 and Python 3.14. The runtime versions here differ deliberately,
which is what makes this a cross-platform check.

| Command | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | ok |
| `npm run recovery:verify` on the task branch | exit 2, expected: the checkpoint accepts only `main` or its one named review branch |
| `npm run recovery:verify` on a clean `main` worktree at the same commit | ok |
| `npm run typecheck` | ok |
| `npm test` | 1189 passed, 95 files |
| `npm run test:session-recovery` | 8 passed |
| `python -m unittest discover -s tests` (in `evals/`) | 18 passed |
| `python -m inspect_node.verify` | 29 samples. Each run: 29/29 deterministic, 29/29 replay, 56/56 fixture checks, 29/29 exported replay. No live model. |

**Cross-platform determinism.** The 29 per-sample final kernel state hashes are byte-identical to
two archived runs:

- `main-consolidation-2026-10-20` (`8281db6`, Node 24.21.0, Python 3.14.3);
- `pr21-review-2026-10-20` (`96a431f`).

`git diff 8281db6 afdf390 -- src evals/inspect_node evals/experiments` is empty, so identical
source gave identical kernel state on two platforms. Against the older `3512ded` evidence 0/29
match. That is explained by source: `src/eval/episode.ts` changed its genesis JSON normalisation
in `3512ded..96a431f`.

The comparison tool is `python -m inspect_node.compare_hashes`. It fails closed: the older
reference returns exit 1. The `research-conformance` workflow now repeats this comparison on
every push.

**Not reproduced.** The 80 native broker/participant checks need PowerShell, which is absent
here, and a baseline archive. Hosted Windows CI is still their only current evidence.

**After this branch's changes.** The 29-sample verifier still gives 29/29 hashes identical to the
same archived evidence. The multi-actor and contract additions do not touch the single-actor
path.
