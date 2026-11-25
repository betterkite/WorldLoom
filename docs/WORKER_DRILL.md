# 独立 worker 的隔离演练

用途：#2 的本机 E2 证据。默认产品 Compose 的 worker、用户数据库和 provider 凭据不在
故障注入范围内。`worker:chaos-smoke` 不再接受没有明确临时项目的旧调用方式。

## 安全边界

- 项目名必须为 `worldloom-drill-` 加 32 位随机十六进制；明确指定 Compose 文件绝对路径。
- 使用 `docker/worker-drill.compose.yml`。PostgreSQL 数据只放 tmpfs，没有持久卷，宿主端口
  随机且仅绑定 127.0.0.1。worker 无发布端口，缓存只读，单进程并发上限为 1。
- 脚本核对实际容器 ID、项目/服务/文件/专用标记、数据库名称、宿主端口和 worker 的
  数据库 URL。创建 fixture 前要求 worlds、jobs、compile runs 和 vectors 均为空。
- 不注入 provider 凭据，只使用预先下载的本地模型。Docker、数据库或 provider 的原始
  错误不输出。不能以此演练证明远程 provider 的调用成本或账户级限额。
- SIGKILL 前再次核对范围，只重启已核对的那个容器 ID；不运行默认 `compose up`。
- 只删除 UUID fixture，删除前复查身份。确认临时世界、任务及向量不存在后才报告 PASS；
  cleanup 失败也使验收失败。不要把 `passed` 之前的步骤输出当作最终结果。

## 准备与执行

以下在独立产品 checkout 的 Bash 中执行。两个场景分别使用全新临时项目；不要把已有
数据库或真实服务改名后冒充演练环境。先下载模型、构建待测镜像并完成许可门禁；候选
镜像能用于本机验证，不代表它已经获准公开分发。

```bash
pnpm embeddings:download
docker build --target runtime -t worldloom-app:drill .
docker build --target migrate -t worldloom-migrate:drill .
```

在一次新的 Bash 会话中准备 `kill-restart` 场景：

```bash
set -euo pipefail
export WORLDLOOM_DRILL_PROJECT="worldloom-drill-$(node -e 'console.log(require("node:crypto").randomUUID().replaceAll("-", ""))')"
export WORLDLOOM_DRILL_DATABASE="${WORLDLOOM_DRILL_PROJECT//-/_}"
export WORLDLOOM_DRILL_IMAGE="$(docker image inspect worldloom-app:drill --format '{{.Id}}')"
export WORLDLOOM_DRILL_MIGRATE_IMAGE="$(docker image inspect worldloom-migrate:drill --format '{{.Id}}')"
export WORLDLOOM_DRILL_MODEL_CACHE="$PWD/.cache/worldloom-embeddings"
export WORLDLOOM_DRILL_COMPOSE="$PWD/docker/worker-drill.compose.yml"
drill_compose() {
  docker compose --env-file /dev/null -p "$WORLDLOOM_DRILL_PROJECT" -f "$WORLDLOOM_DRILL_COMPOSE" "$@"
}
trap 'drill_compose down --remove-orphans --timeout 10' EXIT
drill_compose up -d --wait --wait-timeout 50 db
docker run --rm --pull=never --network "${WORLDLOOM_DRILL_PROJECT}_default" \
  -e "DATABASE_URL=postgresql://worldloom_drill:disposable-local-only@db:5432/$WORLDLOOM_DRILL_DATABASE" \
  "$WORLDLOOM_DRILL_MIGRATE_IMAGE"
drill_compose up -d --no-deps --scale worker=1 worker
export DATABASE_URL="postgresql://worldloom_drill:disposable-local-only@$(drill_compose port db 5432)/$WORLDLOOM_DRILL_DATABASE"
pnpm worker:chaos-smoke -- --project="$WORLDLOOM_DRILL_PROJECT" \
  --compose-file="$WORLDLOOM_DRILL_COMPOSE" --scenario=kill-restart \
  --entities=128 --timeout-ms=300000
```

该场景要求 task 先进入 running 才 SIGKILL；恢复完成时 attempts 必须为 2、recoveryAttempts
为 1，再显式重投同一个已完成任务，要求 attempts 为 3、向量数量及唯一目标数量不变，
每条向量为 1024 维且非空。冷模型或 CPU 限额会影响耗时；超时就是失败，不跳过门禁。

双副本场景在**另一个全新临时项目**重复上述准备流程，将启动行改为
`drill_compose up -d --no-deps --scale worker=2 worker`，验收行改为：

```bash
pnpm worker:chaos-smoke -- --project="$WORLDLOOM_DRILL_PROJECT" \
  --compose-file="$WORLDLOOM_DRILL_COMPOSE" --scenario=replica-race \
  --entities=64 --timeout-ms=300000
```

两副本须在场且每进程上限为 1；首次 attempts 为 1、重投后为 2、recoveryAttempts 为 0，
向量仍完整且唯一。它证明该拓扑下观测到的单次领取，不证明两个进程每次同时到达 CAS。
真实测试数据库上的受控并发 CAS 与错误脱敏测试见 `tests/semantic-worker-claim.test.ts`；
其 embedding 为假实现，不能代替真实本地模型运行。

## 2026-09-30 本机结果

arm64 worker 候选 image ID
`sha256:a65a0678a1ea4876a5ca9e27d5b6fcc60e7addf050e4f86e6800b9ef0eb3efbc`；
迁移 image ID
`sha256:1555f1a671aa0df9ab55ff1cabf083313fdc95c4336d372ce4b1d878567596fa`。
两个临时 PostgreSQL 均应用 15 个迁移；未提供远程凭据，只读挂载已有模型。

| 场景 | 实际观察 |
| --- | --- |
| SIGKILL / 重启 / 恢复 / 重投 | 128 条；attempts 1→2→3；recoveryAttempts=1；128 个唯一目标、128 条非空 1024 维向量；同一容器 StartedAt 从 07:25:13.995Z 变为 07:25:15.162Z |
| 双 worker / 同任务重投 | 64 条；首次 attempts=1，重投后=2；recoveryAttempts=0；64 个唯一目标、64 条非空 1024 维向量 |
| 清理与现有服务 | 两场景的 worlds/jobs/compile runs/vectors 归零，测试容器和网络均移除；现有 3 个产品容器 ID、StartedAt 未改变且 healthy，5 个用户世界仍在 |

候选不是最新源码的干净发布制品；本次脚本在宿主执行，worker 使用上述固定镜像。
尚未覆盖目标容量/SLO、跨主机时钟/网络分区、滚动发布、实际 provider 错误注入和账户级
预算。不得据此关闭 #2 的目标环境门槛或宣称生产 HA 已通过。
