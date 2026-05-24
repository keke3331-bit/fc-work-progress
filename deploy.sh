#!/bin/bash
# src/ → docs/ に同期してコミット＆プッシュするスクリプト

set -e

# ── 同期 ──────────────────────────────────────────
cp src/index.html    docs/index.html
cp src/css/style.css docs/css/style.css
cp src/js/main.js    docs/js/main.js
cp src/data/work_items.js docs/data/work_items.js
[ -f src/display.html ] && cp src/display.html docs/display.html

echo "✅ docs/ 同期完了"

# ── コミットメッセージ ─────────────────────────────
MSG="${1:-docs/ を src/ と同期}"

# ── ステージ＆コミット＆プッシュ ─────────────────
git add src/ docs/
git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>/dev/null || echo "（変更なし、コミットスキップ）"
git push origin main

echo "🚀 プッシュ完了"
