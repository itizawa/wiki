#!/usr/bin/env bash
# main でビルドした管理画面（キャッシュ admin-dist-<sha>）のうち、いまの HEAD でそのまま使えるもののキーを、使いたい順に出す。
#   scripts/ci-admin-dist-keys.sh <マージ先のブランチ（例: origin/main）>
# マージ先との分かれ目（merge-base）から、マージ先の履歴を最大 MAX 個さかのぼる。
# 管理画面に影響する変更（scripts/ci-scope.sh で @wiki/admin が確かめる対象になる変更）が、そのコミットから HEAD までにあれば、
# そのコミットより前のものは古いので、そこで止める。1つも出なければ、呼び出し側はビルドする
# pipefail は付けない（grep -q が先に終わると、前のコマンドが SIGPIPE で失敗扱いになり、判定が逆になる）
set -eu

base="$1"
max="${MAX:-20}"
here="$(dirname "$0")"

merge_base=$(git merge-base "$base" HEAD)
for sha in $(git rev-list --first-parent --max-count="$max" "$merge_base"); do
  if "$here/ci-scope.sh" "$sha" | grep '^affected=' | grep -qw '@wiki/admin'; then
    break
  fi
  echo "admin-dist-$sha"
done
