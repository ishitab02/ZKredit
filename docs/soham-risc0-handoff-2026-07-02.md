# Soham Handoff — RISC Zero Guest Contract and Model Authority

Date: 2026-07-02

This is the current ML-side handoff for the real distilled-model RISC Zero guest.

Short version:

- `sklearn` is now **training-only / diagnostic-only**
- the **canonical exported artifact** is the only authoritative runtime model
- `distilled_model_hash = sha256(exact bytes of the canonical artifact file)`
- the Rust guest should match the exported artifact, not sklearn runtime behavior

---

## 1. What Changed

We found that there were effectively two versions of the student model:

1. the raw `sklearn` RandomForest runtime path
2. the exported tree artifact path

On normal real rows they matched exactly.

On adversarial near-threshold rows they did **not** always match.

That means sklearn can no longer be treated as the final runtime authority for
proof-sensitive inference.

The decision now is:

- **training authority:** sklearn
- **runtime / proof authority:** exported artifact

So from this point on, if there is any conflict between sklearn runtime behavior
and the exported artifact, the exported artifact wins.

---

## 2. What The Official Model Is

The official distilled student model is:

- a `RandomForest`
- trained on the **transformed** feature space
- using `top_k = 30` selected transformed features

Held-out quality of the student relative to the teacher:

- exact fidelity: `0.7815`
- within ±1 bucket: `0.935`

These are the student’s model-quality numbers.

They are separate from the parity question.

Parity question = “does Rust run the same model as the exported artifact?”

---

## 3. The Canonical Artifact You Must Use

Canonical file:

- `model_store/risc0_distilled_model.json`

Human/debug sidecar:

- `model_store/risc0_distilled_model.metrics.json`

The canonical file is the only file that defines runtime semantics.

The metrics file is **not** part of the runtime contract and must not affect the
guest or the model hash.

---

## 4. Hash Rule

This is locked now:

- `distilled_model_hash = sha256(exact bytes of model_store/risc0_distilled_model.json)`

Important consequences:

- do **not** reserialize JSON on the Rust side before hashing
- do **not** hash the metrics file
- do **not** hash a reconstructed struct
- hash the exact file bytes via `include_bytes!` or equivalent

Why:

- this avoids cross-language serialization drift
- this avoids the “hash inside the file it hashes” problem
- this ensures Python and Rust are talking about the same model

---

## 5. What Is Inside The Canonical Artifact

The canonical artifact contains only fields that affect inference:

- `schema_version`
- `student_model_type`
- `teacher_target`
- `selected_feature_space`
- `selected_feature_indices`
- `prediction_contract`
- `preprocessing`
- `forest`

More concretely:

### `selected_feature_space`

Currently:

- `transformed`

Meaning:

- the student does **not** run on the raw 30-column wallet vector
- it runs on the selected subset of the transformed feature vector

### `selected_feature_indices`

These are the 30 selected transformed features the student actually consumes.

### `preprocessing`

Contains:

- `clip_upper_bounds`
- `log1p_mask`
- `robust_center`
- `robust_scale`

### `forest`

Contains:

- `n_classes`
- `classes`
- `n_estimators`
- `max_depth`
- `trees`

Each tree contains:

- `children_left`
- `children_right`
- `feature`
- `threshold`
- `leaf_values`

This is the actual model.

---

## 6. What Is NOT In The Canonical Artifact

These are deliberately excluded from the hashed runtime contract:

- held-out fidelity metrics
- feature names
- human labels / schema labels
- reporting metadata
- the model hash itself

Reason:

those things are useful for people, but they do not change inference.

We do not want the on-chain model identity to change because:

- a feature label was renamed
- a metric was updated
- a report string changed

---

## 7. Serialization Contract

The Python exporter serializes the canonical artifact with:

- UTF-8
- `json.dumps(..., sort_keys=True, separators=(",", ":"), allow_nan=False)`

This gives us compact deterministic bytes.

Current exported hash:

- `a0cd691502db6f69874fe5ad4a6123d2854f416f48ca9ce8dc161886b4a0e27e`

Your guest should compute the same hash from the same file bytes.

---

## 8. Runtime Prediction Contract

This is the exact inference contract the guest should match.

For each tree, in tree index order:

1. start at the root node
2. compare `feature_value <= threshold`
3. if true, go left
4. else, go right
5. continue until a leaf
6. take that leaf’s class counts
7. normalize that leaf into a probability vector by dividing by the leaf total

Then:

8. sum those normalized leaf probability vectors across all trees
9. divide by `n_estimators`
10. `argmax` of the final vector = `risk_bucket`
11. `max` of the final vector = `confidence`

Tie-break:

- `argmax` resolves to the lowest class index

This is already encoded in the canonical artifact’s `prediction_contract`.

---

## 9. `confidence_bps` Rule

This is also locked:

- `confidence_bps = floor(clamp(confidence, 0, 1) * 10000 + 0.5)`

This is intentionally **not** Python’s default `round()`.

Reason:

- Python uses banker’s rounding
- Rust `round()` does not match that at `.5`

So both sides must use the explicit half-up rule above.

---

## 10. Important Boundary Finding

We built a near-threshold adversarial parity harness to test values placed
directly around real tree thresholds.

This matters because normal real rows almost never land exactly on a split
threshold, so ordinary parity tests can miss the one place where model behavior
actually diverges.

### Real result from the harness

Using:

- `25` base rows
- `10` visited split nodes per row

we generated:

- `250` real visited split nodes
- `1750` adversarial test vectors

Observed:

- `live_tie_nonleft_cases = 26`
- `branch_mismatches = 309`
- `bucket_mismatches = 16`
- `confidence_bps_mismatches = 241`

Interpretation:

- the exported f64 artifact and sklearn runtime are not identical on knife-edge
  threshold cases
- the likely reason is lower-precision routing inside sklearn runtime inference

This is exactly why the exported artifact is now the runtime authority.

Do **not** try to match sklearn’s boundary behavior.

Match the exported artifact.

---

## 11. What The Rust Guest Should Treat As Truth

Truth order:

1. canonical artifact bytes
2. canonical artifact inference contract
3. canonical artifact hash

Not:

1. sklearn object
2. sklearn runtime predictions
3. sklearn tie behavior

If Rust and sklearn disagree at a boundary, but Rust matches the exported
artifact, Rust is considered correct.

---

## 12. What You Need To Implement Now

Your next implementation task is the real distilled-model guest.

The current fixture guest that commits placeholder values should be replaced by a
guest that:

1. loads the canonical artifact data embedded in the guest
2. consumes the selected transformed feature vector private input
3. runs the forest exactly as described above
4. computes:
   - `risk_bucket`
   - `confidence`
   - `confidence_bps`
5. emits the agreed journal fields
6. computes or exposes the same `distilled_model_hash` from the artifact bytes

You do **not** need sklearn in the guest.

You should treat the canonical artifact as the model.

---

## 13. Journal / Public Output Expectations

Current cross-team understanding:

- guest does not compute `identity_commitment`
- API supplies it as a public input
- guest echoes it into the journal
- attestation binds the proof to the subject via that value

The remaining open item on your side is the default derivation rule for a wallet
that is not enrolled in a multi-wallet identity group.

Once you finalize that derivation, the API side can supply the exact value you
expect.

---

## 14. What You Should Ignore

Please ignore these as runtime authorities:

- sklearn prediction output
- sklearn tree routing
- metrics sidecar content
- feature-name strings
- any older EZKL-oriented assumptions about the student runtime

They may still be useful for:

- training
- evaluation
- debugging

But not for the proof guest.

---

## 15. What I Need Back From You

Once you wire the real guest, I need:

1. the guest implementation path
2. the exact journal layout bytes/order you used
3. confirmation that the guest hashes the exact canonical artifact bytes
4. one parity run against the Python exported reference
5. one real prove/receipt run with:
   - output bucket
   - output confidence_bps
   - image ID
   - receipt/proof success
   - wall-time and memory if measured

That will let us close the loop on:

- guest correctness
- model-hash correctness
- proof readiness

---

## 16. Bottom Line

The main architectural decision is already made:

- sklearn trains the student
- exported artifact defines the student
- Rust guest must match the exported artifact

So the next phase is not deciding the model anymore.

It is implementing the real guest against the locked artifact contract.
