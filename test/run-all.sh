#!/usr/bin/env bash
# Runs every suite. No framework, no deps: node + jq only.
set -uo pipefail
cd "$(dirname "$0")"

rc=0
for t in "node test-load.js" "node test-metrics.js" "node test-md.js" "node test-devhooks.js" "node test-vscode.js" "node test-render.js" "node test-launch.js" "node test-askq.js" "./test-install.sh"; do
  echo "── $t"
  # shellcheck disable=SC2086
  $t || rc=1
  echo
done

[ "$rc" = 0 ] && echo "ALL SUITES PASS" || echo "SUITE FAILURES"
exit "$rc"
