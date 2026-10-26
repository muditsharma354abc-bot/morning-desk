#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch (GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_ENV=production npm run build
cd dist && rm -rf .git && touch .nojekyll
git init -q -b gh-pages && git add -A
git -c user.name="muditsharma354abc-bot" -c user.email="muditsharma354abc-bot@users.noreply.github.com" commit -qm "Deploy $(cd .. && git rev-parse --short HEAD 2>/dev/null || echo local)"
git push -q -f https://github.com/muditsharma354abc-bot/morning-desk.git gh-pages
rm -rf .git
echo "Deployed: https://muditsharma354abc-bot.github.io/morning-desk/ (live in about 1 minute)"
