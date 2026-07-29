#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_DIR="${PLUGIN_DIR}/upstream"

if command -v bun >/dev/null 2>&1; then
  BUN_COMMAND=(bun)
else
  BUN_TOOL_DIR="${PLUGIN_DIR}/.tools/bun-1.3.14"
  BUN_TOOL_BIN="${BUN_TOOL_DIR}/node_modules/.bin/bun"
  if [ ! -x "${BUN_TOOL_BIN}" ]; then
    echo "未找到 Bun，在隔离工具目录安装固定版本 Bun 1.3.14"
    npm install --prefix "${BUN_TOOL_DIR}" --no-save --package-lock=false bun@1.3.14
  fi
  BUN_COMMAND=("${BUN_TOOL_BIN}")
fi

cd "${UPSTREAM_DIR}"
"${BUN_COMMAND[@]}" install --frozen-lockfile
"${BUN_COMMAND[@]}" run build

cd "${PLUGIN_DIR}"
node scripts/prepare.mjs
node scripts/verify-dist.mjs
