# GitHub to CODING Push Sync

The `Sync to CODING` workflow copies each pushed branch or tag from
`haishuiaa1234/Octop` to the same ref in
`git@e.coding.net:geneseeq/hospital/workspace.git`.

## Behavior

- A local `git commit` alone does not synchronize anything. Push to GitHub to
  trigger Actions.
- The full reachable commit history and annotated tag objects are preserved.
- Only the pushed ref is updated. Other CODING refs remain unchanged.
- CODING-only commits, retagging conflicts, and source rewinds are rejected.
  There is no force push or automatic conflict resolution.
- Deleting a GitHub branch or tag does not delete it from CODING.
- Runs are serialized per ref. Rapid pushes may coalesce pending runs; the next
  successful fast-forward still includes all ancestor commits.
- A manual run synchronizes the branch or tag selected in Actions.
- This workflow synchronizes source, not a release artifact, and does not wait
  for the pull-request CI workflow.

Both production machines poll CODING `main_gys` using their existing deployment
scripts. Synchronizing that branch can automatically publish changes to
production. Pushing another branch does not deploy it to those machines.

## Activation

1. Create a dedicated SSH deploy key for this sync, with write access to only
   `hospital/workspace`. Do not reuse either production machine's read-only key
   or a personal account password.
2. Add its private key to the GitHub repository Actions secret
   `CODING_SYNC_SSH_KEY`. Never commit the key to either repository.
3. Verify the CODING RSA SSH host fingerprint against the repository's deploy
   keys settings. The workflow pins the verified value:
   `SHA256:jok3FH7q5LJ6qvE7iPNehBgXRw51ErE77S0Dn+Vg/Ik`.
4. Disable CODING's old daily external-repository import. That import can
   overwrite target-only changes and should not run alongside this workflow.
5. Publish both `.github/workflows/sync-to-coding.yml` and
   `scripts/ci/sync_coding.sh` to every source branch that must trigger sync.
   At setup time these are `main`, `main_gys`, and
   `codex/shixiaohe-welcome-logo`. Create future branches from a configured branch.
   Old branches or tags whose commits do not contain the workflow cannot trigger
   it automatically.
6. Confirm GitHub Actions is enabled for the fork. Run the workflow and verify a
   successful job and matching source/target refs before declaring it active.

Choose GitHub as the write source for synchronized refs. Direct commits to the
same CODING branch can create divergence; the sync deliberately fails instead
of overwriting them.

## Failure Handling

Open the failed `Sync to CODING` run in GitHub Actions.

- Missing secret: provision `CODING_SYNC_SSH_KEY` with the dedicated private key.
- Permission denied: check that its public key has write permission to workspace.
- Host mismatch: verify a key rotation through CODING's authenticated settings
  before updating the pinned fingerprint. Do not disable host verification.
- Non-fast-forward or tag conflict: inspect both histories and decide explicitly
  how to reconcile them. Do not add `--force` to bypass the failure.
- Network error: rerun the failed job or manually run the workflow on the branch.
  Synchronization is idempotent when both refs already match.

Pausing or disabling this GitHub workflow stops GitHub-to-CODING sync only. It
does not pause the two production machines' CODING update tasks.

## Local Checks

```bash
uv run pytest tests/unit/test_coding_sync.py -q
uv run ruff check tests/unit/test_coding_sync.py
uv run ruff format --check tests/unit/test_coding_sync.py
bash -n scripts/ci/sync_coding.sh
```

The tests use local bare repositories and never push to the production remote.
