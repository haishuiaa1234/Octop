#!/usr/bin/env bash
set -euo pipefail

remote=${1:?Usage: sync_coding.sh REMOTE FULL_REF}
ref=${2:?Usage: sync_coding.sh REMOTE FULL_REF}

case "$ref" in
  refs/heads/*|refs/tags/*) ;;
  *) printf 'Ref must be a fully qualified branch or tag: %s\n' "$ref" >&2; exit 2 ;;
esac
if ! git check-ref-format "$ref"; then
  exit 2
fi

# A missing source must fail, never become a deletion refspec.
git rev-parse --verify "$ref" >/dev/null
# Non-forced pushes reject divergence and preserve annotated tag objects.
git push --atomic --porcelain "$remote" "$ref:$ref"
