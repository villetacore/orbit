#!/usr/bin/env bash
# Prints the version to release for HEAD, without the leading "v".
#
#   next-version.sh [auto|patch|minor|major]
#
# Git tags are the only record of the version. In "auto" mode the commits since
# the last tag decide the bump:
#   - "feat: ..."                     -> minor
#   - "fix!: ..." or "BREAKING CHANGE:" -> major (minor while the version is 0.x)
#   - anything else                   -> patch
# A commit that is already tagged keeps its version, so re-running a release
# does not create a new one. The first release is 0.1.0.
set -euo pipefail

bump="${1:-auto}"
case "$bump" in
  auto | patch | minor | major) ;;
  *)
    echo "unknown bump: $bump" >&2
    exit 2
    ;;
esac

semver='^v[0-9]+\.[0-9]+\.[0-9]+$'

current=$(git tag --points-at HEAD | grep -E "$semver" | sort -V | tail -n 1 || true)
if [ -n "$current" ]; then
  echo "${current#v}"
  exit 0
fi

last=$(git tag --list 'v*' | grep -E "$semver" | sort -V | tail -n 1 || true)
if [ -z "$last" ]; then
  echo "0.1.0"
  exit 0
fi

IFS=. read -r major minor patch <<<"${last#v}"

if [ "$bump" = auto ]; then
  log=$(git log --format=%B "$last..HEAD")
  bump="patch"
  if grep -qE '^feat(\([^)]*\))?:' <<<"$log"; then
    bump=minor
  fi
  if grep -qE '^[a-z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE:' <<<"$log"; then
    if [ "$major" -eq 0 ]; then bump=minor; else bump=major; fi
  fi
fi

case "$bump" in
  major) echo "$((major + 1)).0.0" ;;
  minor) echo "$major.$((minor + 1)).0" ;;
  patch) echo "$major.$minor.$((patch + 1))" ;;
esac
