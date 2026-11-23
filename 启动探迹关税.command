#!/bin/zsh
set -eu
app_root="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$app_root"
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  node_bin="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ -z "$node_bin" ]]; then
  print '请先安装 Node.js 20 或更高版本，再双击启动。'
  open 'https://nodejs.org/'
  read 'reply?按回车关闭…'
  exit 1
fi
mkdir -p runtime
"$node_bin" scripts/prepare-data.mjs
if ! curl -fsS --max-time 2 'http://127.0.0.1:8787/api/status' | "$node_bin" -e "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{try{process.exit(JSON.parse(s).appId==='tanji-tariff'?0:1)}catch{process.exit(1)}})"; then
  nohup "$node_bin" server.mjs >>runtime/server.log 2>&1 </dev/null &
  print $! >runtime/server.pid
fi
for attempt in {1..20}; do
  if curl -fsS --max-time 1 'http://127.0.0.1:8787/health' >/dev/null 2>&1; then
    open 'http://localhost:8787/install'
    print '探迹关税已启动。手机试用入口见浏览器中的安装页。'
    exit 0
  fi
  sleep 0.5
done
print '暂未启动成功，请查看 runtime/server.log。'
read 'reply?按回车关闭…'
