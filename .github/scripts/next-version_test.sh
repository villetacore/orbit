#!/usr/bin/env bash
# Runs next-version.sh against throwaway git repositories.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/next-version.sh"
failed=0

repo() {
  cd "$(mktemp -d)"
  git init -q
  git config user.email ci@example.com
  git config user.name ci
  git commit -q --allow-empty -m "Initial commit"
}

commit() { git commit -q --allow-empty -m "$1"; }

check() {
  local name="$1" want="$2" got
  shift 2
  got=$("$script" "$@")
  if [ "$got" = "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: got $got, want $want"
    failed=1
  fi
}

repo
check "first release" 0.1.0
check "first release ignores the bump" 0.1.0 major

repo
git tag v1.2.3
commit "Fix login"
check "plain commit is a patch" 1.2.4
check "explicit minor" 1.3.0 minor
check "explicit major" 2.0.0 major
commit "feat(ui): add page"
check "feat is a minor" 1.3.0
check "explicit patch overrides feat" 1.2.4 patch
commit "fix(api)!: change response"
check "breaking is a major" 2.0.0

repo
git tag v1.2.3
commit "$(printf 'Change API\n\nBREAKING CHANGE: removed field')"
check "breaking footer is a major" 2.0.0

repo
git tag v0.4.1
commit "feat!: rework"
check "breaking is a minor before 1.0" 0.5.0
check "explicit major leaves 0.x" 1.0.0 major

repo
git tag v1.2.3
commit "Fix login"
git tag v1.2.4
check "tagged commit keeps its version" 1.2.4
check "tagged commit ignores the bump" 1.2.4 major

repo
git tag v1.9.0
git tag v1.10.0
git tag nightly
git tag v2.0.0-rc.1
commit "Fix login"
check "tags sort as versions, others are ignored" 1.10.1

exit "$failed"
