#!/usr/bin/env bash
# Publish the API to a Hugging Face Space (Docker SDK). Needs: HF_TOKEN (write), HF_SPACE (e.g. "user/askuoc-api").
# The Space builds backend/Dockerfile itself; secrets live in the Space settings, never in this repo.
set -euo pipefail
: "${HF_TOKEN:?HF_TOKEN is required}" "${HF_SPACE:?HF_SPACE is required (owner/name)}"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
git clone --quiet --depth 1 "https://user:${HF_TOKEN}@huggingface.co/spaces/${HF_SPACE}" "$work/space" 2>&1 | sed "s/${HF_TOKEN}/***/g"
cd "$work/space"
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
mkdir -p backend
cp -r "$OLDPWD/backend/app" "$OLDPWD/backend/requirements.txt" backend/
cp "$OLDPWD/backend/Dockerfile" Dockerfile
cp "$OLDPWD/deploy/hf/README.md" README.md
find . -name __pycache__ -type d -prune -exec rm -rf {} +

git add -A
if git diff --cached --quiet; then echo "Space already up to date."; exit 0; fi
git -c user.name="github-actions" -c user.email="actions@users.noreply.github.com" commit -q -m "deploy: ${GITHUB_SHA:-manual}"
git push --quiet origin HEAD:main 2>&1 | sed "s/${HF_TOKEN}/***/g"
echo "Deployed ${GITHUB_SHA:-manual} to ${HF_SPACE}."
