#!/usr/bin/env bash
# Promote the root dev checkout to the main production worktree.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_WORKTREE="/home/justin/run/BallShoot-prod"

cd "$REPO_ROOT"

if [[ $# -ne 1 || ( "$1" != "--dry-run" && "$1" != "--confirm" ) ]]; then
  echo "Usage: ./promote.sh [--dry-run | --confirm]"
  exit 1
fi

if [[ "$(git branch --show-current)" != "dev" ]]; then
  echo "Error: promote.sh must run from the root dev checkout."
  exit 1
fi

if [[ "$1" == "--dry-run" ]]; then
  echo "Commits on dev not yet in main:"
  git log main..dev --oneline
  echo
  echo "Files changed in dev compared with main:"
  git diff --name-status main..dev
  echo
  echo "No files are archived during BallShoot promotion."
  exit 0
fi

if [[ ! -e "$PROD_WORKTREE/.git" ]]; then
  echo "Error: Prod worktree is missing. Run ./setup.sh first."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: root/dev checkout is not clean."
  git status --short
  exit 1
fi

if [[ -n "$(git -C "$PROD_WORKTREE" status --porcelain)" ]]; then
  echo "Error: Prod/main worktree is not clean."
  git -C "$PROD_WORKTREE" status --short
  exit 1
fi

REMOTE="$(git remote | head -n 1 || true)"
if [[ -n "$REMOTE" ]]; then
  git pull "$REMOTE" dev
fi

(
  cd "$PROD_WORKTREE"
  git checkout main
  if [[ -n "$REMOTE" ]]; then
    git pull "$REMOTE" main
  fi
  git merge dev --no-edit
  if [[ -n "$REMOTE" ]]; then
    git push "$REMOTE" main
  fi
  ./rebuild.sh
)

echo "Production is running at https://ballshoot.fireorbooty.com"

