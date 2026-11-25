# 本机备份与恢复

## 升级前保存作品

从含有 `docker-compose.yml` 和 `.env.local` 的产品目录执行。下面的命令适用于本机 Compose 的 `db` 服务，导出容器中 `POSTGRES_DB` 指定的数据库。若你通过 `WORLDLOOM_CONTAINER_DATABASE_URL` 指向另一数据库，请先核对 app 和 worker 实际使用的数据库，再选择相应的服务和源库名。导出前保存正在编辑的章节，并避开数据库迁移。备份包括导出开始时已写入数据库的原稿、正史、待审变更、任务和累计用量。

```sh
(
  set -eu
  umask 077
  backup_root="$HOME/WorldLoom-backups"
  mkdir -p "$backup_root"
  backup_dir=$(mktemp -d "$backup_root/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
  docker compose --env-file .env.local exec -T db sh -ec \
    'exec pg_dump -w -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_dir/worldloom.partial"
  cd "$backup_dir"
  mv worldloom.partial worldloom.dump
  if command -v sha256sum >/dev/null; then
    sha256sum worldloom.dump > SHA256SUMS
  else
    shasum -a 256 worldloom.dump > SHA256SUMS
  fi
  printf '备份已保存：%s\n' "$backup_dir"
)
```

记下最后打印的目录。把其中的 `worldloom.dump` 和 `SHA256SUMS` 一起复制到你控制的另一处存储，备份中包含文稿正文。保留该次使用的产品版本，并单独保管 `.env.local`，恢复时还需要模型凭据。模型缓存可以重新下载。

## 在新数据库中试恢复

在同一产品目录，把 `backup_dir` 替换为备份目录。命令先核对文件校验值，再在运行中的 `db` 服务里创建一个新数据库并以单个事务导入。如果同名库已存在，创建步骤会报错并退出。请为恢复库预留磁盘空间。

```sh
(
  backup_dir='/替换为备份目录的完整路径'
  set -eu
  (
    cd "$backup_dir"
    if command -v sha256sum >/dev/null; then
      sha256sum -c SHA256SUMS
    else
      shasum -a 256 -c SHA256SUMS
    fi
  )
  restore_db="worldloom_restore_$(date -u +%Y%m%d_%H%M%S)"
  docker compose --env-file .env.local exec -T db sh -ec '
    createdb -w -U "$POSTGRES_USER" -T template0 "$1"
    exec pg_restore -w --single-transaction --no-owner --no-privileges -U "$POSTGRES_USER" -d "$1"
  ' sh "$restore_db" < "$backup_dir/worldloom.dump"
  docker compose --env-file .env.local exec -T db sh -ec '
    exec psql -X -w -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" \
      -c "SELECT count(*) AS worlds FROM public.worlds" \
      -c "SELECT count(*) AS world_versions FROM public.world_versions" \
      -c "SELECT title, left(content, 60) AS preview FROM public.chapters ORDER BY id LIMIT 3" \
      -c "SELECT status, count(*) FROM public.changes GROUP BY status ORDER BY status"
  ' sh "$restore_db"
  printf '恢复库：%s\n' "$restore_db"
)
```

对照备份时的世界和版本数量，并核对一章熟悉的文稿以及待审变更。迁移或继续创作前，请使用兼容的版本检查恢复库。要正式切换时，先保存现用库并安排停止写入，让 app 和 worker 一起指向已核对的恢复库；备份时间之后的编辑要另行保留。[应用及 worker 恢复步骤](./ROLLBACK_RECOVERY.md)

## 自动化恢复演练的范围

2026-10-01：以下是新补入的源码设计与待执行步骤，**没有运行演练、测试、迁移或 Docker**。
现运行服务未更新，历史表数/世界数演练不证明当前累计用量功能或新脚本已通过。
`pnpm db:backup:drill` 是恢复链路演练，不是长期备份工具或 v0.1 发布批准。

## 执行范围与数据一致性

待用户恢复验证后，才从产品 checkout 执行。只接受本机 Unix socket 的 Docker daemon、
运行中的 Compose `project=worldloom/service=db` 容器，以及源库 `worldloom` 或
`worldloom_test`；默认容器/角色/源库均为 WorldLoom 配置。覆盖值须通过严格名称校验，
不接收连接 URI、任意项目库或远程 daemon。初次解析后固定完整容器 ID，不追随同名替换。
PostgreSQL 连接固定容器内 `/var/run/postgresql:5432`，禁止密码提示，不加载应用 dotenv。
需要已有本地数据库权限；脚本不新增账号、获取凭据或授予权限。

源库只执行只读、repeatable-read 事务：导出快照，在该事务内读取 public 表的内容摘要，
让 custom-format `pg_dump --snapshot` 使用同一快照，导出完成才关闭源事务。
因此比较的是同一时间点，不把两次独立读取之间的新写入误判成恢复失败；快照之后的调用
或编辑不在此次比较范围内。机制依据 PostgreSQL 16 的
[快照同步说明](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION)
与 [pg_dump 文档](https://www.postgresql.org/docs/16/app-pgdump.html)。

恢复目标是新建的 `worldloom_backup_drill_<32 hex>` 数据库（template0），必须先确认此次
创建和数据库所有权标记。只接受 PostgreSQL 16、有限且严格校验的 public 表清单；发现
非系统的其他 schema、foreign table、非法表名或清单不一致即失败，不据部分数据报成功。
迁移历史表和 worlds 必须存在。`llm_usage_calls` 若已存在，和其他表一起比较实际内容；
若尚未迁移，仅明确报告 `not-present-in-source-snapshot`，不能声称统计恢复已验收。

每行在 PostgreSQL 中按固定时区/序列化设置转为 JSONB，再取 UTF-8 SHA-256；数据库按
行摘要排序，脚本逐行构建表摘要及十进制字符串行数，不把用户正文或全部行摘要缓存在
报告中。原语见 PostgreSQL 的
[二进制串函数](https://www.postgresql.org/docs/16/functions-binarystring.html)。相同行数但
内容变化也应失败。这是内容比对，不是完整数据库语义证明或秘密匿名化：低熵记录的摘要
仍可能被猜测，报告只存于受限本机位置，不自动上传或入 Git。

## 临时资源与通过条件

- 使用已有一个本机 DB 容器，不新建压力容器；顺序导出/恢复，无并行 restore jobs。
  容器内 mktemp 创建严格路径的 0700 私有目录，0600 随机所有权文件；dump 位于其中。
- 源内容读取设置 statement/lock/idle 超时和 4 MB work_mem；管理 SQL 有服务端时限，
  宿主单命令 60 秒，源读取会话有总时限，关闭确认有时限。导出/恢复工具在容器内使用
  GNU timeout：45 秒发 TERM、再等 5 秒发 KILL，只针对此次工具的进程组，不杀共享
  数据库后端。先检查工具支持，不存在/不匹配即失败，不临时安装或退回无时限执行。
  内容流和命令输出有界。仍须实际记录内存、磁盘、耗时和锁影响，
  不能将单容器或 work_mem 当作整个 PostgreSQL 的硬内存上限。
- 错误不回显原始 stderr、SQL 结果、连接或正文。杀死 Docker CLI 不证明容器内执行已结束；
  工具终止也不证明数据库后台查询已取消，任何失败/退出/清理无法确认都不能报告 PASS。
- 清理前重新核对原容器 ID、数据库标记、私有目录权限与所有权文件。只 DROP 此次精确
  数据库，确认它已不存在；只删除精确 dump/所有权文件并 rmdir。无 FORCE、后端终止、
  前缀查找或递归删除。已有用户源库、世界、服务与卷不是清理对象。
- 仅在内容一致、会话关闭、临时数据库及目录清理均确认后返回 `passed: true`。
  `durableBackup: false`、`releaseApproved: false` 固定保留。失败报告的精确候选 ID/路径
  用于人工核对，不证明资源一定存在；创建成功但确认丢失、标记异常或额外目录内容可能
  留下临时资源。不得据前缀批量删除，应先只读核对存在性、活动连接与所有权再决定恢复。

演练读取现有用户数据，恢复这些数据到同一容器内临时库，会增加磁盘占用及短期读取负载。
只在合适维护窗口运行；遇到资源不足停止并登记失败，不堆叠容器重试。恢复对象中的数据库
代码仍由 PostgreSQL 执行，这不是针对不可信 dump 的安全沙箱。

2026-10-03 源码复核：PostgreSQL 16 的
[pg_dump](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/bin/pg_dump/pg_dump.c)
与 [恢复实现](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/bin/pg_dump/pg_backup_archiver.c)
会重置 statement/lock 等超时，不能把 PGOPTIONS 当作这两个工具的硬期限；因此补入容器内
工具时限。参数行为依据 [GNU timeout 源码](https://github.com/coreutils/coreutils/blob/master/src/timeout.c)。
工具能力、信号效果和后台查询清理均尚未实测；同快照也不消除并发 DDL 的风险，执行窗口
不要同时迁移或修改 schema。当前没有启动工具、测试或数据库，也没有新建临时资源。

## 迁移和回滚不能省略的步骤

1. 先为精确候选源码完成已授权的低资源测试、干净迁移链与安装验证。这里新增的两组
   contract/orchestration 用例使用模拟边界，不连接数据库，也不证明真实导出/恢复。
2. 在实际迁移前，另行建立**可保留的真实备份/恢复点**，明确存放位置、受限权限、恢复目标、
   可接受的数据损失窗口和保留期；演练成功后会删除 dump，不能把它当作唯一回滚备份。
3. 对该备份完成隔离恢复与关键功能/数据核对，再按正式 `db:deploy` 应用增量迁移，禁止
   `db:push` 或在用户库故障注入。新增用量表前的备份不能证明用量表已恢复。
4. 候选 app/worker 使用同一数据库，验证使用量、未知记录、重试、跨进程重启及世界删除
   不清空统计；旧应用回滚保留新增表，不自动 DROP 或回退用户数据。
5. 恢复较旧备份会丢失该时间点之后的创作与用量记录；明确影响后再执行。恢复内容摘要
   不能替代实际应用启动、健康/功能恢复、RPO/RTO 或版本兼容验收。

当前内容核对覆盖 public 表行数据/行数，不单独证明索引、序列状态、约束/触发器行为、
角色/授权、large objects、全局配置、PITR、卷损坏或跨主机恢复；相关要求仍须分别验证。
本机首发适用记录见 [LOCAL_DEPLOYMENT.md](./LOCAL_DEPLOYMENT.md)，用量口径见
[LLM_USAGE.md](./LLM_USAGE.md)，发布全门槛见 [V0_1_RELEASE.md](./V0_1_RELEASE.md)。

累计统计的迁移前后/混合制品兼容分析、应用回退及备份恢复检查表见
[LLM_USAGE_ROLLOUT.md](./LLM_USAGE_ROLLOUT.md)。它只分析统计增量；保留新增表不等于
完整 v0.1 领域/任务状态可任意回退，实际回退制品与恢复点仍须分别验收。
