#!/usr/bin/env bash
# Validate in Docker, then rebuild the current environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f index.html || ! -f docker-compose.yml ]]; then
  echo "Error: rebuild.sh must be run from a BallShoot environment checkout."
  exit 1
fi

docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

echo "Running validation in Docker..."
if ! docker compose run --rm --no-deps test; then
  echo "Error: validation failed; fix the errors before rebuilding."
  exit 1
fi

echo "Rebuilding BallShoot..."
docker compose up --build --force-recreate -d --remove-orphans

