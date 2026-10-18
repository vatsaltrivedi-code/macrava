#!/bin/bash
# Runs every test; prints each failing check and exits non-zero if any suite fails.
set -o pipefail
cd "$(dirname "$0")/.."
python3 build_local.py > /dev/null || exit 1
bad=0
for t in tests/*.test.js; do
  echo "== $t"
  if out=$(node "$t" 2>&1); then st=0; else st=$?; fi
  echo "$out" | grep -E "^FAIL|ALL PASS|FAILED|Error" || echo "$out" | tail -3
  [ "$st" = 0 ] || bad=1
done
echo "== schema"
if out=$(bash tests/schema.test.sh 2>/dev/null); then echo "$out" | tail -1; else echo "$out" | grep -E "FAIL"; bad=1; fi
echo "== sec.js"
if out=$(node sec.js 2>&1); then echo "$out" | tail -1; else echo "$out" | grep -E "FAIL"; bad=1; fi
echo "== qa.js"
out=$(node qa.js 2>&1 | tail -1); echo "$out"; [ "$out" = "NO ISSUES" ] || bad=1
[ $bad = 0 ] && echo "ALL SUITES PASS" || { echo "SOME SUITES FAILED"; exit 1; }
