#!/usr/bin/env bash
# CI で確かめるパッケージを決める（.github/workflows/ci.yml）。
#   scripts/ci-scope.sh [BASE]
# BASE（比べる先のコミット）からの差分で、変更したパッケージと、それに依存するパッケージを出す。
# apps/ と packages/ の外（pnpm-lock.yaml、tsconfig.base.json、ワークフローなど）を変えたときと、BASE が空のときは全部。
# 出力は $GITHUB_OUTPUT にそのまま足せる形：
#   filter=<pnpm に渡す絞り込み>
#   affected=<パッケージ名を空白区切りで>
# pipefail は付けない（grep -q が先に終わると、前のコマンドが SIGPIPE で失敗扱いになり、判定が逆になる）
set -eu

base="${1:-}"
if [ -z "$base" ] || git diff --name-only "$base...HEAD" | grep -qvE '^(apps|packages)/|\.md$'; then
  filter="-r"
else
  filter="--filter='...[$base]' --filter='!wiki'"
fi
affected=$(eval "pnpm $filter ls --depth -1 --json" | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s||"[]").map((p)=>p.name).join(" ")))')
echo "filter=$filter"
echo "affected=$affected"
