# WorldLoom 生产部署安全契约

本文档是正式发布前的部署门禁。WorldLoom 当前提供的是**本地/受控主机应用**，不是开箱即用的公网多租户服务；`docker compose` 的默认端口只绑定回环地址，不能直接改成公网监听后上线。

2026-10-01 本机单人首发按用户范围使用独立 [LOCAL_DEPLOYMENT.md](./LOCAL_DEPLOYMENT.md)
适用性预检和运行证据；公网/对外控制记 N/A 而非伪造通过。本文件的 strict 生产契约保持
不变，不把普通开发模式称为本机发布门槛。新本机预检与启动边界改动仅补入源码，尚未验证。

## 必须满足的边界

### 1. 网关认证与网络隔离

- 应用容器的 4310 端口只允许被反向代理或受控内网访问；公网安全组不得直接放行 4310。
- 仓库提供的 app/worker Compose 服务以非 root 用户运行，启用只读根文件系统、丢弃所有 Linux capabilities、`no-new-privileges` 与 PID 上限；仅 `/tmp` 和 app 的 Next image cache 使用有界 tmpfs。部署方仍需验证所用 Compose/Docker 版本、宿主机 daemon 与平台安全策略。
- 反向代理必须执行 OIDC、SAML、Basic Auth 或等价的组织身份认证；应用自身目前没有多租户认证与授权模型。
- 代理必须清理客户端提交的 `X-Forwarded-*`，再由代理写入可信的 scheme/host/client-ip 信息；应用日志中的 correlation id 必须与网关请求 id 关联。
- 必须启用 TLS、HSTS、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 和合适的 CSP；不要把数据库端口暴露到公网。
- 应用默认发送 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` 和 `X-DNS-Prefetch-Control`；仅当可信 TLS 反向代理已就绪时设置 `WORLDLOOM_TLS_TERMINATED=true`，应用才附加 HSTS。CSP 仍由部署网关按实际脚本/资源策略配置。

### 2. 限流与请求体策略

限流应在代理或 API gateway 执行，并按已认证用户优先、IP 作为兜底维度：

| 类别 | 建议默认值 | 说明 |
| --- | --- | --- |
| 普通 `/api/*` | 60 requests/min/user，burst 20 | 读接口与小型治理请求 |
| LLM/长任务入口 | 10 requests/min/user，concurrency 2 | `/ask`、genesis、compile、chapter finalize |
| URL/文件摄入 | 5 requests/min/user，单请求 ≤10 MiB | 仍必须经过应用内 SSRF 与字节上限校验 |
| 导出/批量接口 | 10 requests/min/user，concurrency 1 | 防止 ZIP/JSON 导出压垮实例 |

超限统一返回 `429`、`Retry-After` 和可关联的 request/correlation id。限流不能替代应用内上限：应用已经对 JSON、文本、二进制和远程响应执行实际字节数校验。

### 3. 数据库、密钥与发布顺序

1. 凭据只通过 secret manager/运行时环境注入，不写入镜像、仓库、日志或导出文件。
2. 发布前备份 PostgreSQL，并在单独维护窗口执行 `pnpm db:deploy`；禁止用 `db:push` 代替迁移。
3. 先启动数据库并确认迁移与 `/api/health/ready`，再切换应用流量；回滚应用镜像前确认新旧 schema 的兼容窗口。
4. 数据库备份必须有恢复演练记录；`worldloom-db-data` 卷不是备份策略。

本地演练入口为 `pnpm db:backup:drill`。2026-10-01 新源码改为本机 PostgreSQL 16 同导出快照的
public 表内容摘要/行数核对，恢复到带本次所有权标记的精确临时库；会话关闭及清理均确认后
才报通过，不覆盖用户源库。此次修复与模拟用例尚未执行，旧表数/世界数记录不是新能力证据。
演练 dump 清理后不存在，不是迁移前可保留的长期备份；仍需另建真实恢复点、验证恢复与
应用回滚。完整边界见 [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)。对外生产的跨卷/跨主机、
容量和恢复目标仍须由部署方备份系统另行验收，本机脚本不授予发布权限。

模型 profile 的 `pricing`、`limits.maxInputTokensPerRun`、`limits.maxOutputTokensPerRun` 和
`limits.maxEstimatedCostUsdPerRun` 必须由部署方依据当前 provider 合同填写。当前
`deepseek-official` 使用 [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
中 `deepseek-flash`（当前文档标示模型版本 `DeepSeek-V4.1-Flash`）的峰值、未命中缓存输入价与峰值输出价作为保守估算
（核对日：2026-09-23 UTC；input 0.30 USD/M、output 1.20 USD/M）。价格表来源、核对日、模型版本和计费基准
同时登记在 `config/llm.json`；严格 preflight 拒绝缺少 HTTPS 来源、未来日期或超过 90 天的价格快照。
该自动检查只验证配置元数据和核对日期，不会联网抓取、比对价格页，也不能验证账户合同；发布负责人仍须
人工确认来源、模型和计费口径。
DeepSeek 价格、峰谷时段和模型版本会变化，部署前必须
重新核对并按实际账户额度填写 limits。公开价格不能推导账户余额或本次发布预算；没有明确额度
时，系统不会猜测每次操作上限，也不会把未知价格伪装成成本；一旦配置上限，CompileRun 会在
每次 provider 响应后检查持久化累计 token/估算成本；问答、创世、推演和答案评测会在单个业务操作内
累计检查，并将后续请求的 max_tokens 收紧到剩余额度。超限后停止该操作的后续模型请求。

该应用侧预算是“已报告用量上的停止阈值”，不是 provider 账单硬上限：当前在途请求已经发生，响应后才有
准确 usage；单次请求（或有界重试）可能使费用越过阈值。需要严格支出上限时，部署方必须另设并验证
provider 账户/项目级额度或其他外部硬限额；不能把本应用的 `maxEstimatedCostUsdPerRun` 宣称为防超额账单保证。
同步路径的预算账本只存在于当前业务操作/进程，不是跨用户、跨请求、跨 worker 或跨副本的总账本；持久化
`CompileRun` 另有任务级累计校验。provider 请求及内部有界重试可能已产生费用后才返回 usage，故这些仍是应用层
软停止；生产发布仍必须验证账户级预算/配额与网关速率/并发限制，并记录对应边界。

正式部署也可以通过 `WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN`、
`WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN` 和
`WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN` 为默认 profile 注入批准的每次业务操作运行时上限，适用于
同一制品在不同账户/环境发布的场景。适用范围包括单个 CompileRun、问答、创世、推演或整批答案评测；不表示
所有并发操作的全局累计额度。环境变量只覆盖对应字段；只有未设置的字段沿用配置文件值。
显式空值、非正数、非有限费用或不安全的 token 整数会使普通/strict preflight 失败，运行时也在
读取凭据和发起模型请求前抛出 `llm_budget_config_invalid`，不回退到旧额度或当作“未配置预算”。
API 返回脱敏的 `503 / llm_budget_config_invalid`，无自动 `Retry-After`；这属于部署配置错误，
不是预算已经耗尽或 provider 网络故障。需要取消某项覆盖时移除环境变量，不能填写空串；
profile 中本来未配置的额度仍可保持 `null`，不自动猜测永久上限。
它们不是额度查询，也不会从 provider 自动推导账户余额。2026-10-01 本段运行时修复和对应
回归用例尚未执行验证，现运行旧镜像未更新。

### 可选的累计 CNY 预留保护

2026-10-01 用户对本机单人首发明确选择：不设累计费用或操作预算上限，只查看累计用量，
自行判断。该范围内不要求人为设定永久额度或费用拦截；默认 profile 的 limits 保持未配置，
预算环境覆盖与累计 CNY guard 不启用。用量统计不能依赖启用预算 guard 才工作，也不能
把未配置额度说成未知余额、零成本或“无限账户余额”。单次模型输出能力、文稿大小和进程
资源保护不是消费额度，仍保留。此决定不改变未来对外/受控生产部署的严格合同。

累计统计使用独立数据库记录，与可选 guard 解耦；不展示 provider 余额。实现、缺漏边界和
备份/迁移/回滚要求见 [LLM_USAGE.md](./LLM_USAGE.md)。2026-10-01 仅补入源码，数据库迁移
和同制品验证尚未执行，当前服务未升级，不把记录器当作完整财务账本或账户硬限制。

`WORLDLOOM_LLM_BUDGET_CNY` 与 `WORLDLOOM_LLM_BUDGET_LEDGER` 必须成对配置；两者都未设置时，
不启用累计保护，也不推定任何默认额度。金额须能转换为正的安全整数 micro-CNY，账本路径须为
绝对路径。启用后，预检检查默认 profile 的正数 CNY 输入/输出价格以及 HTTPS 来源、有效核对日
和 90 天内时效；不完整或非法配置在普通模式和 strict 模式均阻断，而不是只给警告。
这不替代已有 USD/单操作预算或任何 strict 生产事实门禁。

预检只检查这些配置字段，不打开、创建、清空或结算账本，不验证所填价格是否与账户合同一致。
其他可选择 profile 的 CNY 价格仍需单独准备；默认 profile 检查不能证明所有模型均可使用。
真实调用还要求显式最大输出 token 数。部署方必须在实际运行环境确认账本目录可写、挂载可持久化，
预算范围内各进程共享同一个本地文件；独立容器各自的临时文件不构成共享总额度。既有账本中的
保留费用、未知 usage 和账本配置变更可能阻断请求，不得删账本以重置预算。

该保护按已配置价格对每次调用（包括重试）预留估算费用，完整 usage 才结算；它不是 provider
账户余额或账单硬限额。预算错误的 API 反馈为脱敏的 `429 / llm_budget_exceeded`，无自动
`Retry-After`；应检查预算和用量记录，而不是盲目重试。2026-10-01 本段实现和回归用例已补入
源码，但用户要求暂不运行验证，尚不构成部署通过证据。

发布前可运行 `pnpm deployment:preflight` 做本地结构检查；普通模式读取被 Git 忽略的 `.env` 和
`.env.local` 简单 `KEY=value` 项，优先级为已导出的进程环境、`.env.local`、`.env`，且只输出变量名和配置状态。
严格模式默认只检查调用进程继承的环境变量，不自动读取 `.env.local`，避免把 Next.js 本地文件
误当作已注入容器/服务的凭据。确需从文件验证时，必须显式指定 `--runtime-env-file <path>`；该文件应与
部署命令的环境来源一致。预检不做变量展开；若 Compose `--env-file` 含 `$VAR`/`${VAR}` 引用，
应从部署系统解析后的进程环境运行预检，而不是把模板文件原样传给 `--runtime-env-file`。
这仍只是配置输入检查，不能替代部署后健康状态和真实 provider 请求验收。
词法检索版正式发布必须在部署环境中运行严格门禁：

```bash
pnpm deployment:preflight -- --strict
```

若 Compose 和预检使用的文件只含完整字面值（无变量展开），可显式传入同一个文件，例如：

```bash
docker compose --env-file .env --profile full up -d --build
NODE_ENV=production pnpm deployment:preflight -- --strict --runtime-env-file .env
```

严格模式要求 `NODE_ENV=production`、PostgreSQL `DATABASE_URL`、HTTPS
`NEXT_PUBLIC_APP_URL`、可信 TLS 终止、显式 `WORLDLOOM_WORKER`、默认 LLM profile 的凭据/价格/预算限制，
并按当前配置使用词法检索。它不能替代真实 provider、网关、备份或 HA 压测，
但会在发布前拒绝“未知配置被误当作已验证”的状态。

需要在发布门禁中承诺语义增强时，执行 `pnpm embeddings:download` 准备本地模型，再执行
`pnpm deployment:preflight -- --strict --require-semantic`；只要本地模型缓存存在，远程
`EMBEDDINGS_API_KEY` 就不是硬依赖。远程端点仅作为优先路径，HTTP/网络/JSON 失败会回退本地；
远程 provider 的额度或余额不在产品健康接口中展示，也不应被“凭据已配置”替代真实请求验收。

严格模式还要求部署方将以下事实逐项设置为 `true`：
`WORLDLOOM_GATEWAY_AUTH_CONFIRMED`、`WORLDLOOM_RATE_LIMIT_CONFIRMED`、
`WORLDLOOM_BACKUP_RESTORE_CONFIRMED`、`WORLDLOOM_MIGRATION_ROLLBACK_CONFIRMED`、
`WORLDLOOM_TARGET_SCALE_CONFIRMED`、`WORLDLOOM_WORKER_TOPOLOGY_CONFIRMED`、
`WORLDLOOM_SUPPLY_CHAIN_CONFIRMED`、`WORLDLOOM_OBSERVABILITY_CONFIRMED` 和
`WORLDLOOM_PRIVACY_CONFIRMED`。
这些变量不是自证安全的开关，而是发布工单/演练记录的绑定点；没有对应证据时必须保持
`false` 或未设置，严格门禁应失败。
建议使用 [部署证据记录模板](./DEPLOYMENT_EVIDENCE_TEMPLATE.md) 逐项留痕。

`docker compose --profile full up -d --build` 会先运行一次性 `migrate` 服务，再启动 `app` 和不发布
宿主端口的 `worker` 服务；worker 使用相同 standalone 镜像但固定 `WORLDLOOM_WORKER=true`，只运行
DB 任务轮询。worker 不设置固定容器名，可用 `docker compose --profile full up -d --scale worker=2`
启动多个副本。迁移服务失败时，Compose 不会满足 app/worker 的 `service_completed_successfully`
条件。容器内默认连接 Compose 的 `db:5432`，自定义连接串使用 `WORLDLOOM_CONTAINER_DATABASE_URL`，
避免把宿主机 `.env` 中的 `DATABASE_URL`（通常指向 `localhost`）误传入容器。

在已准备本地 embedding 模型的 full Compose 环境中，可运行 `pnpm worker:smoke` 验证独立 worker
实际领取一个 queued `SemanticIndexJob`、完成索引并持久化向量；该命令只创建带固定用途的临时世界，
结束时通过级联删除清理。它是本地 `E2` runtime 证据，不能替代生产 worker 的故障注入、容量、跨主机
lease 和滚动发布演练。

同一环境可运行 `pnpm worker:recovery-smoke` 验证一个带过期 heartbeat 的 `running` 任务会被独立
worker 重新领取（attempts 至少增加一次）、完成索引并只持久化预期向量；该命令同样只使用临时世界
并在 finally 中清理。它覆盖本地 stale-recovery 的 `E2` 契约，不等于生产进程杀停、跨主机 lease、
容量或滚动发布证据。

真实进程故障演练必须使用专用的 `docker/worker-drill.compose.yml`、随机临时项目和 tmpfs
数据库，按 [WORKER_DRILL.md](./WORKER_DRILL.md) 准备。`worker:chaos-smoke` 没有默认项目，
旧的无 scope 命令会失败；脚本先验证实际容器和数据库身份，再仅 SIGKILL/重启已核对的
worker ID，验证 lease 恢复、同任务重投、完整且唯一的向量与最终清理。双副本场景只验证
本机观测到的单次领取，受控并发 CAS 另有 DB 测试。两者均为本机 E2，不替代生产跨主机
故障注入、容量或账户预算验证；不要在正在使用的 full Compose 上执行故障注入。

## 任务运行模型与规模边界

`CompileRun/CompileChunk` 与 `SemanticIndexJob` 都是数据库持久化任务，具有 checkpoint、心跳和陈旧任务回收。当前 Next 进程会在提交请求后触发本地 runner，因此：

- 单实例、受控主机：可以使用现有 runner；服务重启后由状态查询/任务入口恢复 queued 或 stale job。
- 受控生产 worker：可用 `WORLDLOOM_WORKER=true pnpm start`（或 `pnpm start:worker`）启动 DB 轮询 worker；它只负责领取 queued/stale job，普通 Web 实例保持 `WORLDLOOM_WORKER=false`。数据库 compare-and-set 领取允许多个 worker 副本竞争同一任务，但生产拓扑、故障切换与失败率仍须监测和验收。
- 每个 worker 进程的 CompileRun 与 SemanticIndexJob 总并发由 `WORLDLOOM_WORKER_MAX_CONCURRENCY` 限制（默认 4，允许 1–32）；这是进程内保护，不是跨副本全局上限。副本数为 N 时，名义并发上限可达 N × 每进程上限；生产需结合 provider 账户限额、数据库连接池和压测结果设置副本及并发。
- stale heartbeat 自动恢复最多执行 3 次；达到上限后任务进入 `failed` 并保留固定、脱敏的原因码。人工恢复会开启新的恢复预算，累计执行次数仍保留在 `attempts` 中。该限制保护崩溃恢复路径，不会对外部 provider 错误执行隐式重试。
- 商业多副本：worker 任务有数据库 CAS 与 heartbeat lease，可横向运行；Compose 双副本启动和竞争领取由 CI 验证，但这不构成生产 HA/SLO 证据。Web/worker 目标副本、全局并发和故障切换仍必须保持在实测范围内，直至完成目标规模压测与生产演练。
- 独立 worker 的最小契约是：只领取 queued/stale job、按 heartbeat lease 执行、幂等写入 chunk/vector、达到 3 次 stale recovery budget 后进入 failed，并把脱敏错误与 correlation id 留在任务记录中。

## 可观测性与上线前检查

- `/api/health/live` 只检查进程响应，不访问数据库或外部 provider；`/api/health/ready` 检查 PostgreSQL，依赖不可用时返回 503。平台应分别将它们映射到 liveness/readiness probe。
- `/api/health` 是模型诊断接口：凭据已配置且缓存过期时会发送带认证的 `GET /models`，不得用作 liveness probe。网关应按部署边界保护健康与诊断路由；任何接口都不得回显凭据或上游响应正文。
- 2026-10-03 新源码对非成功 chat 响应及 header-only `/models` 探测的未读正文发出
  transport abort 和 best-effort 清理，不等待可长期挂起的 cancel promise，也不将清理
  异常替换为原有 provider HTTP 错误。重试、缓存与未知用量口径不改；mock 用例尚未执行，
  不证明 provider 工作/费用已经停止、真实连接释放或当前服务已采用修复。
- 同日成功 chat JSON 源码增加 4 MiB 单响应实际字节边界、有界增长缓冲、完整解码/解析
  及正文中断竞争。超限给脱敏 `llm_response_too_large` / HTTP 502 和 correlation ID，
  不设置 Retry-After 或自动重试；usage 保留失败/未知，不截断、记零或推定退款。这是
  资源边界而非消费额度，不覆盖 embedding 或全局堆/数据库/并发。解码、对象和 transport
  仍有额外分配，支持输出适配和低资源基线待验证；新模拟用例未执行，旧服务未升级。
- 后续 embedding 源码对错误正文不读取/不等待清理，对成功正文设独立 16 MiB 单批
  实际字节边界和既有 30 秒期限；批数量、唯一合法 index、配置维度和有限 number
  严格校验，非法/超限/正文超时转本地，任一远程批失败则整组回退，避免混合向量。
  本地再失败保留 typed EmbeddingError，已有检索路径据此降级词法；当前未验证或部署，
  不证明实际本地推理/索引/查询可用。wire 边界不是本地推理/全输入/全局堆或消费上限，
  不查询/展示 embedding 余额，统计仍只包含 chat；详见 [LLM_USAGE.md](./LLM_USAGE.md)。
- 关注 `CompileRun` 的 queued/running/failed、`SemanticIndexJob` 的 stale/failed、429 比例、LLM token/延迟和数据库连接池。
- 检查 `x-correlation-id` 是否贯穿网关、应用日志、任务错误和人工工单。
- 上线前必须完成：外部认证、限流压测、备份恢复演练、迁移回滚演练、目标规模检索/编译压测和真实 GitHub CI 运行。

在上述条件完成前，项目状态保持“可在本地/受控环境验收”，不宣称公网多租户商业部署已完成。
