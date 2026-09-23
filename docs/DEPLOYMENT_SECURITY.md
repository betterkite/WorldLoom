# WorldLoom 生产部署安全契约

本文档是正式发布前的部署门禁。WorldLoom 当前提供的是**本地/受控主机应用**，不是开箱即用的公网多租户服务；`docker compose` 的默认端口只绑定回环地址，不能直接改成公网监听后上线。

## 必须满足的边界

### 1. 网关认证与网络隔离

- 应用容器的 4310 端口只允许被反向代理或受控内网访问；公网安全组不得直接放行 4310。
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
3. 先启动数据库并确认迁移与 `/api/health`，再切换应用流量；回滚应用镜像前确认新旧 schema 的兼容窗口。
4. 数据库备份必须有恢复演练记录；`worldloom-db-data` 卷不是备份策略。

本地可复现的安全演练命令为 `pnpm db:backup:drill`：它在 `worldloom-db` 内创建带固定前缀的临时数据库，执行 custom-format `pg_dump`/`pg_restore`，比较 public table 与 `worlds` 行数后删除临时数据库和 dump；不会覆盖 `worldloom` 或 `worldloom_test`。该命令只能证明本地容器链路，生产仍需使用部署方备份系统完成跨卷/跨主机恢复和迁移回滚演练。

模型 profile 的 `pricing`、`limits.maxInputTokensPerRun`、`limits.maxOutputTokensPerRun` 和
`limits.maxEstimatedCostUsdPerRun` 必须由部署方依据当前 provider 合同填写。当前
`deepseek-official` 使用 [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
中 `deepseek-flash` 的峰值、未命中缓存单价作为保守估算（核对日：2026-09-23 UTC；input
0.30 USD/M、output 1.20 USD/M）。DeepSeek 价格、峰谷时段和模型版本会变化，部署前必须
重新核对并按实际账户额度填写 limits。公开价格不能推导账户余额或本次发布预算；没有明确额度
时，系统不会猜测每次运行上限，也不会把未知价格伪装成成本；一旦配置上限，编译 runner 会在
继续写入下一个候选前检查 token/估算成本，超限任务进入 failed 并保留错误记录。

发布前可运行 `pnpm deployment:preflight` 做结构检查；脚本会读取被 Git 忽略的 `.env` 和
`.env.local`（已导出的环境变量优先），只输出变量名和配置状态，不输出任何凭据。
词法检索版正式发布必须在部署环境中运行严格门禁：

```bash
pnpm deployment:preflight -- --strict
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
`WORLDLOOM_TARGET_SCALE_CONFIRMED` 和 `WORLDLOOM_WORKER_TOPOLOGY_CONFIRMED`。
这些变量不是自证安全的开关，而是发布工单/演练记录的绑定点；没有对应证据时必须保持
`false` 或未设置，严格门禁应失败。
建议使用 [部署证据记录模板](./DEPLOYMENT_EVIDENCE_TEMPLATE.md) 逐项留痕。

`docker compose --profile full up -d --build` 会先运行一次性 `migrate` 服务，再启动 `app` 和不发布
宿主端口的 `worker` 服务；worker 使用相同 standalone 镜像但固定 `WORLDLOOM_WORKER=true`，只运行
DB 任务轮询。迁移服务失败时，Compose 不会满足 app/worker 的 `service_completed_successfully`
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

## 任务运行模型与规模边界

`CompileRun/CompileChunk` 与 `SemanticIndexJob` 都是数据库持久化任务，具有 checkpoint、心跳和陈旧任务回收。当前 Next 进程会在提交请求后触发本地 runner，因此：

- 单实例、受控主机：可以使用现有 runner；服务重启后由状态查询/任务入口恢复 queued 或 stale job。
- 受控生产 worker：可用 `WORLDLOOM_WORKER=true pnpm start`（或 `pnpm start:worker`）启动 DB 轮询 worker；它只负责领取 queued/stale job，普通 Web 实例保持 `WORLDLOOM_WORKER=false`。至少要保证只有一个受控 worker 实例，并监测其心跳与失败率。
- 每个 worker 进程的 CompileRun 与 SemanticIndexJob 总并发由 `WORLDLOOM_WORKER_MAX_CONCURRENCY` 限制（默认 4，允许 1–32）；这是进程内保护，不等价于多副本全局并发上限，生产仍需结合数据库 lease、provider 限流和压测结果配置。
- 商业多副本：在拆出独立 worker、使用数据库 lease/并发上限并完成压测前，Web 副本数与 worker 数都必须保持在已验证范围内；不能把当前 runner 当作未经验证的 HA worker。
- 独立 worker 的最小契约是：只领取 queued/stale job、按 heartbeat lease 执行、幂等写入 chunk/vector、达到 retry budget 后进入 failed，并把错误与 correlation id 留在任务记录中。

## 可观测性与上线前检查

- `/api/health` 只用于存活/依赖检查，不作为认证接口；不得把凭据或上游响应正文返回给客户端。
- 关注 `CompileRun` 的 queued/running/failed、`SemanticIndexJob` 的 stale/failed、429 比例、LLM token/延迟和数据库连接池。
- 检查 `x-correlation-id` 是否贯穿网关、应用日志、任务错误和人工工单。
- 上线前必须完成：外部认证、限流压测、备份恢复演练、迁移回滚演练、目标规模检索/编译压测和真实 GitHub CI 运行。

在上述条件完成前，项目状态保持“可在本地/受控环境验收”，不宣称公网多租户商业部署已完成。
