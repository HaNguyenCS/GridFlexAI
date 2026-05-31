#!/usr/bin/env bash
# Copy GridFlex OpenClaw skill into the host skills directory (post nemoclaw onboard).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_SRC="$REPO_ROOT/nemoclaw/skills/gridflex-controller"
SKILL_DEST="${OPENCLAW_SKILLS_DIR:-$HOME/.openclaw/skills}/gridflex-controller"

if [[ ! -f "$SKILL_SRC/SKILL.md" ]]; then
  echo "Missing skill source: $SKILL_SRC/SKILL.md" >&2
  exit 1
fi

mkdir -p "$(dirname "$SKILL_DEST")"
rm -rf "$SKILL_DEST"
cp -R "$SKILL_SRC" "$SKILL_DEST"

echo "Installed GridFlex skill → $SKILL_DEST"
echo "Restart NemoClaw/OpenClaw gateway if already running so the skill is picked up."
