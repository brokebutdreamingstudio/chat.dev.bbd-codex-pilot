#!/usr/bin/env sh
set -eu

expected="This file confirms the public pilot can create a pull request."

if grep -Fxq "$expected" docs/SMOKE.md; then
    exit 0
fi

echo "docs/SMOKE.md does not contain the expected confirmation line" >&2
exit 1