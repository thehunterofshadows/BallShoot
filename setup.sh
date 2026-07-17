#!/usr/bin/env bash
# Create and start the watcher-compatible Dev/Prod topology.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_NAME="BallShoot"
PROD_WORKTREE="/home/justin/run/${REPO_NAME}-prod"

cd "$REPO_ROOT"

if [[ ! -f index.html || ! -f docker-compose.yml ]]; then
  echo "Error: setup.sh must be run from the BallShoot repository root."
  exit 1
fi

REMOTE="$(git remote | head -n 1 || true)"
if [[ -n "$REMOTE" ]]; then
  git fetch "$REMOTE"
fi

if ! git show-ref --verify --quiet refs/heads/main; then
  if [[ -n "$REMOTE" ]] && git show-ref --verify --quiet "refs/remotes/${REMOTE}/main"; then
    git branch main "$REMOTE/main"
  else
    echo "Error: main branch does not exist locally or on the remote."
    exit 1
  fi
fi

if ! git show-ref --verify --quiet refs/heads/dev; then
  if [[ -n "$REMOTE" ]] && git show-ref --verify --quiet "refs/remotes/${REMOTE}/dev"; then
    git branch dev "$REMOTE/dev"
  else
    git branch dev main
    if [[ -n "$REMOTE" ]]; then
      git push -u "$REMOTE" dev
    fi
  fi
fi

git checkout dev

if [[ -n "$REMOTE" ]] && ! git rev-parse --abbrev-ref dev@{upstream} >/dev/null 2>&1; then
  git push -u "$REMOTE" dev
fi

docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

write_env() {
  local file="$1"
  local app_env="$2"
  local project="$3"
  local container="$4"

  cat > "$file" <<EOF
APP_ENV=${app_env}
COMPOSE_PROJECT_NAME=${project}
WEB_CONTAINER_NAME=${container}
IMAGE_NAME=ballshoot:${app_env}
EOF
}

write_env "$REPO_ROOT/.env" "dev" "ballshoot-dev" "ballshoot-dev-web"

mkdir -p "$(dirname "$PROD_WORKTREE")"
if [[ ! -d "$PROD_WORKTREE/.git" && ! -f "$PROD_WORKTREE/.git" ]]; then
  if [[ -e "$PROD_WORKTREE" ]]; then
    echo "Error: $PROD_WORKTREE exists but is not a Git worktree."
    exit 1
  fi
  git worktree add "$PROD_WORKTREE" main
fi

write_env "$PROD_WORKTREE/.env" "prod" "ballshoot-prod" "ballshoot-prod-web"

echo "Starting Dev stack..."
(cd "$REPO_ROOT" && docker compose up --build -d --remove-orphans)

echo "Starting Prod stack..."
(cd "$PROD_WORKTREE" && docker compose up --build -d --remove-orphans)

cat <<EOF

BallShoot setup complete.
Dev:  https://dev-ballshoot.fireorbooty.com  ($REPO_ROOT, branch dev)
Prod: https://ballshoot.fireorbooty.com      ($PROD_WORKTREE, branch main)
EOF

