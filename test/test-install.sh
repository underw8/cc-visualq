#!/usr/bin/env bash
# Self-check for the packaged install path: manifests, marketplace resolution,
# and hook registration. `claude plugin validate` does not cover this — it
# passes on a manifest that makes every install fail to load — and neither
# does any suite that pipes JSON straight into a hook.
#
# `plugin install` exits 0 and prints success even when the plugin then fails
# to load, so the load status has to come from `plugin list`.
#
# Installs from a throwaway clone of HEAD, never the working tree: the
# marketplace name is global, so registering the working tree here would
# clobber whatever install mode the developer is using and leave the
# registration pointing at a deleted temp dir.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MP=cc-visualq-test
PLUGIN="cc-visualq@$MP"
WORK="$(mktemp -d)"

fail=0
ok()  { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n     %s\n' "$1" "$2"; fail=1; }

cleanup() {
  claude plugin uninstall "$PLUGIN" >/dev/null 2>&1 || true
  claude plugin marketplace remove "$MP" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# A prior aborted run may have left these behind.
cleanup_stale() {
  claude plugin uninstall "$PLUGIN" >/dev/null 2>&1 || true
  claude plugin marketplace remove "$MP" >/dev/null 2>&1 || true
}
cleanup_stale

# The catalog names the marketplace, so it is renamed in the clone to keep this
# suite's registration distinct from a real one on the same machine.
clone() {
  git -C "$REPO" clone -q . "$1" || return 1
  python3 - "$1" "$MP" <<'PY'
import json, pathlib, sys
d = pathlib.Path(sys.argv[1])
p = d / '.claude-plugin/marketplace.json'
m = json.loads(p.read_text())
m['name'] = sys.argv[2]
p.write_text(json.dumps(m, indent=2) + '\n')
PY
}

# Status line for the installed plugin, e.g. "✔ enabled" or "✘ failed to load".
status_of() {
  claude plugin list 2>&1 \
    | grep -A3 "cc-visualq@$MP" \
    | sed -n 's/^ *Status: *//p' \
    | head -1
}

echo "1. HEAD installs and loads"
if ! clone "$WORK/head" >/dev/null 2>&1; then
  bad "clone HEAD" "git clone failed"
else
  ( cd "$WORK/head" && claude plugin marketplace add ./ ) >/dev/null 2>&1 \
    || bad "marketplace add" "add failed"
  out=$(claude plugin install "$PLUGIN" 2>&1)
  grep -q 'Successfully installed' <<< "$out" \
    && ok "install reports success" \
    || bad "install" "$out"
  st=$(status_of)
  case "$st" in
    *enabled*) ok "plugin loads (status: $st)" ;;
    '')        bad "plugin loads" "no status line; plugin not listed" ;;
    *)         bad "plugin loads" "status: $st" ;;
  esac
fi

echo "2. a manifest hooks key that duplicates the standard path fails to load"
# Guards the regression directly: hooks/hooks.json is auto-loaded, so naming it
# again under manifest.hooks breaks every install. Asserting the failure keeps
# the fix from being silently reverted.
claude plugin uninstall "$PLUGIN" >/dev/null 2>&1 || true
claude plugin marketplace remove "$MP" >/dev/null 2>&1 || true
if ! clone "$WORK/dup" >/dev/null 2>&1; then
  bad "clone for dup case" "git clone failed"
else
  python3 - "$WORK/dup" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1]) / '.claude-plugin/plugin.json'
d = json.loads(p.read_text())
d['hooks'] = './hooks/hooks.json'
p.write_text(json.dumps(d, indent=2) + '\n')
PY
  ( cd "$WORK/dup" && claude plugin marketplace add ./ ) >/dev/null 2>&1
  claude plugin install "$PLUGIN" >/dev/null 2>&1
  st=$(status_of)
  case "$st" in
    *failed*) ok "duplicate hooks key is rejected (status: $st)" ;;
    *enabled*) bad "duplicate hooks key" "loaded anyway — the guard is gone" ;;
    *)        bad "duplicate hooks key" "unexpected status: [$st]" ;;
  esac
fi

echo "3. every hooks.json command path exists in the repo"
missing=""
while IFS= read -r p; do
  [ -f "$REPO/$p" ] || missing="$missing $p"
done < <(grep -o '\${CLAUDE_PLUGIN_ROOT}/[A-Za-z0-9_./-]*' "$REPO/hooks/hooks.json" \
         | sed 's#\${CLAUDE_PLUGIN_ROOT}/##' | sort -u)
[ -z "$missing" ] && ok "all manifest paths resolve" \
  || bad "manifest paths" "missing:$missing"

echo "4. the SessionStart rule is registered and non-empty"
grep -q '"SessionStart"' "$REPO/hooks/hooks.json" \
  && ok "SessionStart registered" || bad "SessionStart" "not in hooks.json"
[ -s "$REPO/hooks/askq-rule.md" ] \
  && ok "rule file has content" || bad "rule file" "missing or empty"
grep -q 'askq-rule.md' "$REPO/scripts/dev-hooks.js" \
  && ok "dev-install registers the rule too" \
  || bad "dev-install" "rule missing from scripts/dev-hooks.js"

echo "5. the vendored bundle travels with HEAD"
# The plugin cache is a file copy, never an `npm install`, so a bundle that is
# not committed is a bundle that is not there at runtime. $REPO is the working
# tree, where an uncommitted file would pass — so this reads the clone, which
# is the only copy that reflects what an install would actually receive.
if ! clone "$WORK/vendored" >/dev/null 2>&1; then
  bad "clone for vendor case" "git clone failed"
else
  bundle="$WORK/vendored/vendor/mermaid.min.js"
  if [ ! -s "$bundle" ]; then
    bad "vendor bundle" "absent from HEAD; an install would 404 the diagram"
  else
    ok "vendor/mermaid.min.js is committed"
    if [ "$(wc -c <"$bundle" | tr -d ' ')" = 3572296 ]; then
      ok "committed byte for byte"
    else
      bad "vendor bundle" "size differs from HEAD"
    fi
  fi
fi

echo
[ "$fail" = 0 ] && echo "PASS" || { echo "FAILURES"; exit 1; }
