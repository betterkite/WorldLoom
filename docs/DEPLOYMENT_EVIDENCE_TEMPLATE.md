# WorldLoom 部署证据包模板

本文件用于记录一次具体发布的可审计证据。它不是安全自证、合规认证或生产备份本身；每个
`PASS` 都必须能由部署方提供可复核的原始记录、命令输出、监控截图/导出、工单或报告链接。
没有证据时必须写 `PENDING`，不得仅因为环境变量被设置为 `true` 就判定通过。

## 使用边界

- 本模板覆盖 WorldLoom 应用、PostgreSQL/pgvector、反向代理、LLM provider、embedding 回退和
  DB worker 的一次发布验收。
- 本仓库中的本地测试、CI 和容器演练最多证明 `E1`/`E2` 级别；它们不能替代生产网关、生产
  备份恢复、目标硬件压测或独立 worker 故障演练。
- 不在仓库或本文件记录 API key、数据库密码、原始用户素材、完整 provider 响应、个人信息或
  未脱敏的日志。外部证据只记录受控系统链接、报告编号和摘要哈希。
- 若控制项不适用，必须写明理由、风险接受人和复核日期，不能留空。

## 0. 证据包治理与可验证性

证据包本身也是受控交付物。截图只能作为辅助材料；涉及发布身份、镜像、迁移、备份、压测和
安全控制的结论，必须优先提供机器可读原始记录、不可变链接或带校验和的报告。

每个 `EV-*` 至少登记以下元数据：

| 字段 | 要求 |
| --- | --- |
| 证据 ID / 控制目标 | 与第 11 节索引和发布决策总表一一对应；不得复用 ID |
| 状态 / 证据等级 | 只能使用本文规定的状态和 `E0`–`E4` 等级 |
| 环境身份 | 环境名、区域/集群、主机或容器标识、应用 commit 和镜像 digest |
| 时间与执行主体 | UTC 时间、执行人/自动化身份、复核人；自动化任务也要记录运行 ID |
| 输入与工具 | 数据集摘要/随机种子、命令、工具版本、配置版本；不得放入秘密值 |
| 期望与观察 | 可量化验收条件、实际结果、错误定义和偏差说明 |
| 原始记录 | 受控存储位置、不可变 URL 或报告编号、SHA-256、生成时间 |
| 保存与访问 | 保存期限、到期处理、访问角色、是否含个人/敏感数据及脱敏方式 |
| 例外与复核 | 例外编号、补偿控制、风险接受人、到期日和下次复核日期 |

证据必须保持“原始记录 → 摘要 → 发布决策”的可追溯链路；发布后不得只修改摘要而不保留原始
记录。涉及日志、素材、provider 响应或备份的证据，应先脱敏，再在受控存储中保存。证据包不能
包含 API key、数据库密码、访问令牌或未脱敏的用户内容。

## 证据与状态规范

### 证据等级

| 等级 | 含义 | 可支持的结论 |
| --- | --- | --- |
| `E0` | 未评估或只有口头说明 | 不能支持发布 |
| `E1` | 静态配置、代码审查、自动化测试或 CI | 证明代码/配置契约，不证明生产运行 |
| `E2` | 本地或隔离 staging 的可重复演练 | 证明流程可执行，不证明生产容量和拓扑 |
| `E3` | 真实生产或同构环境的带时间戳演练 | 可支持该环境的发布决策 |
| `E4` | `E3` 加独立复核、签字和原始记录留存 | 可作为正式审计/变更审批证据 |

### 状态值

只允许使用以下状态：

- `PASS`：验收条件全部满足，证据链接可复核。
- `CONDITIONAL`：有明确限制、补偿控制和到期时间；不得用于无条件生产放行。
- `PENDING`：尚未完成或证据不足。
- `FAIL`：验收条件不满足，发布必须 `NO-GO`。
- `N/A`：确实不适用，必须填写理由和风险接受人。

## 1. 发布身份与变更控制

| 字段 | 值 |
| --- | --- |
| 证据包编号 | `待填写，例如 WL-REL-2026-001` |
| WorldLoom commit SHA | `待填写，40 位完整 SHA` |
| GitHub Actions run / 构建链接 | `待填写` |
| 容器镜像 digest | `待填写，禁止只写 mutable tag` |
| Prisma migration 版本 | `待填写` |
| SBOM / 依赖审计报告 | `待填写，链接或报告哈希` |
| 目标环境 / 区域 / 集群 | `待填写` |
| 发布窗口（UTC） | `待填写` |
| 执行人 | `待填写` |
| 复核人 | `待填写` |
| 变更单 / 工单 / incident 关联 | `待填写` |
| 回滚版本与触发条件 | `待填写` |

发布身份必须能从 Git commit、镜像 digest、迁移版本和部署记录互相对上；任一项无法关联时，
发布状态为 `NO-GO`。

### 1.1 供应链、构建来源与制品证明

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 源码身份 | 仓库 URL、完整 commit、发布 ref、工作树洁净状态和 lockfile 摘要已记录 | `待填写` | `PENDING / E0` | `EV-01` |
| 构建身份 | CI workflow、run ID、构建器身份、Node/pnpm/OS 版本和构建参数已记录 | `待填写` | `PENDING / E0` | `EV-01` |
| 制品摘要 | 部署的镜像以不可变 digest 标识，并与发布记录一致 | `待填写` | `PENDING / E0` | `EV-01` |
| 构建 provenance | 已生成 SLSA/in-toto 兼容 provenance，subject digest 与镜像一致 | `待填写` | `PENDING / E0` | `EV-01` |
| provenance 校验 | 签名/证明可由独立验证方校验；验证失败时禁止发布 | `待填写` | `PENDING / E0` | `EV-01` |
| SBOM | 生成 SPDX 或 CycloneDX SBOM，记录格式版本、生成器和文件摘要 | `待填写` | `PENDING / E0` | `EV-01` |
| 漏洞门禁 | 记录扫描器、漏洞数据库快照、严重度阈值、结果和批准的例外 | `待填写` | `PENDING / E0` | `EV-01` |
| 可复现性 | 独立重建摘要一致；若不一致，已记录差异、原因和风险接受 | `待填写` | `PENDING / E0` | `EV-01` |

“有 CI 运行”不等于“制品可信”。至少要能从部署镜像反查源码、构建运行、SBOM 和 provenance；
无法验证 subject digest、签名或漏洞例外时，`EV-01` 不得标记为 `PASS`。

## 2. 发布决策总表

| 控制域 | 状态 | 等级 | 负责人 | 复核人 | 证据 ID / 链接 | 阻塞发布 |
| --- | --- | --- | --- | --- | --- | --- |
| 变更身份与供应链 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-01` | 是 |
| 网关认证与网络隔离 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-02` | 是 |
| TLS、HSTS 与安全响应头 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-03` | 是 |
| provider 凭据、价格与预算 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-04` | 是 |
| 数据库迁移与兼容窗口 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-05` | 是 |
| 生产备份与恢复 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-06` | 是 |
| Worker 拓扑与故障恢复 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-07` | 是 |
| 目标规模性能与容量 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-08` | 是 |
| 可观测性与告警 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-09` | 是 |
| 隐私、密钥与数据生命周期 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-10` | 是 |

最终决策：`NO-GO / CONDITIONAL GO / GO`（删除不适用项前不得填写 `GO`）

## 3. 网关认证、网络与 Web 安全

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 公网入口 | 只有反向代理可访问 app；4310 不直接暴露 | `待填写` | `PENDING / E0` | `EV-02` |
| 身份认证 | OIDC、SAML、Basic Auth 或等价组织身份认证已启用 | `待填写` | `PENDING / E0` | `EV-02` |
| 未认证请求 | 访问受保护页面/API 得到预期 401/403，不泄露数据 | `待填写` | `PENDING / E0` | `EV-02` |
| 租户/组织边界 | 认证主体不能读取其他主体的数据；若为单租户，已记录边界 | `待填写` | `PENDING / E0` | `EV-02` |
| TLS | 外部入口 HTTPS，证书链、有效期和自动续期已验证 | `待填写` | `PENDING / E0` | `EV-03` |
| HSTS | 仅在可信 TLS 终止后启用，且 max-age/子域策略已审核 | `待填写` | `PENDING / E0` | `EV-03` |
| 转发头 | 代理清理并重写 `X-Forwarded-*`；应用只信任可信代理 | `待填写` | `PENDING / E0` | `EV-03` |
| 响应头 | `nosniff`、`DENY`、`no-referrer`、Permissions-Policy 和实际 CSP 已核验 | `待填写` | `PENDING / E0` | `EV-03` |
| 数据库网络 | PostgreSQL 端口不在公网安全组/公网监听中 | `待填写` | `PENDING / E0` | `EV-02` |
| 入口扫描 | 外部端口、证书和安全扫描结果无未接受的高危项 | `待填写` | `PENDING / E0` | `EV-03` |

限流证据至少记录：维度（用户/IP/组织）、窗口、burst、并发上限、429 与 `Retry-After`、
长任务/摄入/导出接口的单独策略，以及在压测中的 P95/P99 和错误比例。

## 4. Provider、embedding 与预算门禁

### 4.1 LLM provider

| 字段 | 值 |
| --- | --- |
| provider / model | `待填写` |
| 官方价格页/合同链接 | `待填写` |
| 价格核对时间（UTC） | `待填写` |
| 价格版本或截图哈希 | `待填写` |
| 账户/合同允许的发布预算 | `待填写，只记录批准的上限，不记录密钥` |
| `maxInputTokensPerRun` | `待填写` |
| `maxOutputTokensPerRun` | `待填写` |
| `maxEstimatedCostUsdPerRun` | `待填写` |
| 超限行为 | `必须 fail-closed，不写入不完整正史` |
| usage 不完整行为 | `必须拒绝无法验证预算的任务` |
| 预算告警阈值与接收人 | `待填写` |
| 运行时预算覆盖 | `WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN`、`WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN`、`WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN`（如使用，记录批准来源） |
| 对应环境变量/配置提交 | `待填写` |

验收要求：价格和上限来自当前 provider 合同或批准的预算，而不是猜测；执行一次脱敏真实
请求或受控 mock，证明超 token、超估算费用、usage 缺失和 provider 4xx/5xx 都有预期结果。

### 4.2 Embedding 回退

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 本地模型 | `Xenova/bge-m3` 缓存存在，维度/模型身份匹配 | `待填写` | `PENDING / E0` | `EV-04` |
| 远程 embedding 失败 | 自动回退本地，不阻断词法检索 | `待填写` | `PENDING / E0` | `EV-04` |
| 远程和本地均不可用 | 明确降级为词法检索并返回安全状态 | `待填写` | `PENDING / E0` | `EV-04` |
| 余额/凭据隐私 | 健康接口不显示 embedding provider 余额或密钥 | `待填写` | `PENDING / E0` | `EV-04` |

embedding provider 的免费额度不作为生产可用性的唯一假设；如使用本地模型作为主路径，应
记录模型文件来源、版本、校验哈希、缓存准备方式和 CPU/内存要求。

## 5. 数据库、迁移、备份与恢复

| 字段 | 值 |
| --- | --- |
| PostgreSQL / pgvector 版本 | `待填写` |
| 生产数据库实例 / 区域 | `待填写` |
| 备份类型 | `待填写：full / incremental / PITR / WAL 等` |
| 备份频率与保留期 | `待填写` |
| 备份加密与密钥管理 | `待填写` |
| 备份存储隔离 | `待填写：独立账号/项目、跨卷或跨区域` |
| 最近一次成功备份（UTC） | `待填写` |
| 恢复目标 | `待填写：独立实例/跨主机/跨区域` |
| 目标 RPO | `待填写` |
| 目标 RTO | `待填写` |
| 实测 RPO / RTO | `待填写` |
| 数据完整性校验 | `待填写：表数、关键行数、校验和、应用读写` |
| 原始报告链接/哈希 | `待填写` |

### 5.1 迁移与回滚

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 发布前备份 | 已完成并可从受控系统定位 | `待填写` | `PENDING / E0` | `EV-05` |
| 正向迁移 | `prisma migrate deploy` 在目标版本成功 | `待填写` | `PENDING / E0` | `EV-05` |
| 旧应用兼容窗口 | 回滚应用期间 schema 仍兼容，或有明确维护窗口 | `待填写` | `PENDING / E0` | `EV-05` |
| 应用回滚 | 回滚镜像/版本后 health、读写和任务状态正常 | `待填写` | `PENDING / E0` | `EV-05` |
| 数据恢复 | 恢复到独立目标后行数/关键业务链路一致 | `待填写` | `PENDING / E0` | `EV-06` |
| 演练清理 | 演练副本、临时凭据和 dump 均按策略清理 | `待填写` | `PENDING / E0` | `EV-06` |

`worldloom-db-data` 卷、复制或高可用本身不等于备份；必须有一次可操作的恢复记录和实测
RPO/RTO。

## 6. Worker 拓扑、容量与故障恢复

| 字段 | 值 |
| --- | --- |
| Web 实例数 / 版本 | `待填写` |
| Worker 实例数 / 版本 | `待填写` |
| Worker 是否独立于 Web | `待填写` |
| 每个 worker 最大并发 | `待填写` |
| 数据库连接池上限 | `待填写` |
| provider 全局/租户限流 | `待填写` |
| lease / heartbeat 超时 | `待填写` |
| retry budget / backoff | `待填写` |
| 任务监控与告警 | `待填写` |

### 6.1 必做故障注入

| 场景 | 验收条件 | 实际观察 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| worker 在 running 中断 | 任务变 stale 后被重新领取，不重复写入正史 | `待填写` | `PENDING / E0` | `EV-07` |
| 同一任务重复投递 | chunk/vector/Change 幂等，无重复正史 | `待填写` | `PENDING / E0` | `EV-07` |
| provider 超时/429 | 重试受预算和 retry budget 限制，最终状态可解释 | `待填写` | `PENDING / E0` | `EV-07` |
| 数据库短暂不可用 | 心跳/状态不伪造成功，恢复后可继续或安全失败 | `待填写` | `PENDING / E0` | `EV-07` |
| 并发峰值 | 未超过 worker、DB 和 provider 的联合上限 | `待填写` | `PENDING / E0` | `EV-07` |
| worker 滚动发布 | 无任务丢失，旧/新版本 schema 兼容 | `待填写` | `PENDING / E0` | `EV-07` |

## 7. 目标规模性能与容量

| 字段 | 值 |
| --- | --- |
| 硬件/VM/容器 CPU | `待填写` |
| 硬件/VM/容器内存 | `待填写` |
| 数据库 CPU/内存/IO 限制 | `待填写` |
| entities / events / relations / sources | `待填写` |
| 并发用户/请求/长任务数 | `待填写` |
| warm/cold 场景 | `待填写` |
| 检索 P50 / P95 / P99 | `待填写` |
| CompileRun P50 / P95 / P99 | `待填写` |
| embedding 刷新耗时 | `待填写` |
| RSS / CPU 峰值 | `待填写` |
| DB 连接峰值 / pool wait | `待填写` |
| 429、5xx、超时比例 | `待填写` |
| 通过门槛及批准人 | `待填写` |
| 原始压测报告/脚本版本 | `待填写` |

必须同时记录负载生成器、数据集生成方式、随机种子、预热策略、持续时间和错误定义；只有
单次本地命令的 P95 不能证明目标硬件容量。

## 8. 可观测性、告警与事件响应

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| correlation/request ID | 网关、应用、任务错误和工单可互相关联 | `待填写` | `PENDING / E0` | `EV-09` |
| 任务指标 | queued/running/failed/stale 可观测 | `待填写` | `PENDING / E0` | `EV-09` |
| provider 指标 | 延迟、token、4xx/5xx、429 和预算拒绝可观测 | `待填写` | `PENDING / E0` | `EV-09` |
| 数据库指标 | 连接池、锁等待、错误和存储增长可观测 | `待填写` | `PENDING / E0` | `EV-09` |
| 告警演练 | 至少触发一次关键告警并确认接收人/升级路径 | `待填写` | `PENDING / E0` | `EV-09` |
| 事件分级与升级 | 已定义 Sev-1/2/3（或等价等级）、值班人、通知时限和升级路径，并完成一次演练 | `待填写` | `PENDING / E0` | `EV-09` |
| 检测/响应/恢复计时 | 演练记录 MTTD、MTTA、MTTR 或等价时间指标，并与目标比较 | `待填写` | `PENDING / E0` | `EV-09` |
| Runbook | 降级、回滚、恢复、密钥吊销和联系表已评审 | `待填写` | `PENDING / E0` | `EV-09` |
| 事件复盘 | 演练问题、根因、影响、责任人、截止日期和补救验证已登记 | `待填写` | `PENDING / E0` | `EV-09` |

## 9. 密钥、隐私与数据生命周期

| 检查项 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- |
| 密钥由 secret manager/运行时注入，不进入镜像、仓库、日志和导出 | `待填写` | `PENDING / E0` | `EV-10` |
| 生产 `.env`/临时文件权限与清理策略已验证 | `待填写` | `PENDING / E0` | `EV-10` |
| 用户素材、provider 响应和 QA 记录的保存范围已定义 | `待填写` | `PENDING / E0` | `EV-10` |
| 数据分类与处理依据 | 已标注数据分类、处理目的/依据、跨境或第三方处理边界和负责人 | `待填写` | `PENDING / E0` | `EV-10` |
| 导出、删除、备份保留和恢复副本的生命周期已定义 | `待填写` | `PENDING / E0` | `EV-10` |
| 删除/撤销验证 | 已抽样验证删除、账号撤权、密钥轮换和备份到期处理的实际结果 | `待填写` | `PENDING / E0` | `EV-10` |
| 第三方依赖许可证与安全扫描已复核 | `待填写` | `PENDING / E1` | `EV-10` |
| 访问控制、审计日志和离职/撤权流程已验证 | `待填写` | `PENDING / E0` | `EV-10` |

## 10. WorldLoom 当前可复现的仓库/本地证据

以下记录只说明当前仓库和受控本地环境的状态，不得直接填入生产 `GO`：

| 证据 | 当前结果 | 等级 | 复现命令 |
| --- | --- | --- | --- |
| 单元/集成测试 | 103/103 通过 | `E1` | `pnpm test` |
| 类型、格式、lint、构建 | 通过 | `E1` | `pnpm typecheck`、`pnpm format:check`、`pnpm lint:strict`、`pnpm build` |
| 严格部署 preflight | 6 pass、12 failure；生产发布门禁保持阻断 | `E1` | `pnpm deployment:preflight -- --strict` |
| 严格部署 preflight（显式运行时预算覆盖） | 7 pass、11 failure；provider token/estimated-cost limits 通过，生产网关、TLS、备份恢复、worker 拓扑和容量等外部事实仍阻断发布 | `E1` | `WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN=120000 WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN=24000 WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN=1.5 pnpm deployment:preflight -- --strict` |
| API 可用性审计 | 50/50 通过 | `E2` | `pnpm run audit http://localhost:4310` |
| UI 验收 | 41/41，FAIL 0，WARN 0 | `E2` | `node scripts/ui-shots.mjs ...`、`node scripts/ui-acceptance.mjs ...` |
| 本地备份恢复 | 26 表、5 世界，临时数据清理 | `E2` | `pnpm db:backup:drill` |
| 本地 embedding 容器验收 | remote 未配置时，容器使用 `Xenova/bge-m3` 索引 8 条，检索模式为 `hybrid` 并命中 8 条 | `E2` | `pnpm embeddings:download`；Full Compose；`POST /api/worlds/:id/semantic-index` + `/search` |
| 检索基准 | 500 entities、2000 events，12 samples，P95 192.5ms，RSS 增量 23.4 MiB；本机门槛通过 | `E2` | `pnpm benchmark:retrieval http://127.0.0.1:4310` |
| 依赖 SBOM | CycloneDX 1.5 生产依赖清单，包含 lockfile SHA-256 与源码 revision；CI artifact 需按发布记录归档 | `E1` | `pnpm run sbom -- --output artifacts/worldloom-sbom.cdx.json` |
| Compose 安全绑定 | DB 仅绑定 `127.0.0.1:43133` | `E1/E2` | `docker compose config --quiet`、`docker compose ps` |
| Full Compose 拓扑 | `db → migrate → app + worker`；worker 无宿主端口且固定 `WORLDLOOM_WORKER=true` | `E2` | `docker compose --profile full up -d --build`、`docker compose --profile full ps` |
| 独立 Worker runtime smoke | 独立 worker 领取 queued `SemanticIndexJob`，1 次尝试完成并持久化 1 个向量；临时世界已清理 | `E2` | full Compose + 本地模型；`pnpm worker:smoke` |
| 独立 Worker stale recovery | 独立 worker 重新领取过期 heartbeat 的 `running` 任务，attempts 至少增加 1，完成并持久化 1 个向量；临时世界已清理 | `E2` | full Compose + 本地模型；`pnpm worker:recovery-smoke` |
| 独立 Worker kill/restart recovery | 实际 `SIGKILL` worker 后启动时间变化，lease 过期后 attempts `1→2`，64/64 索引完成且向量 `64` 条无重复；临时世界已清理 | `E2` | full Compose + 本地模型；`pnpm run worker:chaos-smoke -- --timeout-ms=180000 --entities=64`；2026-09-23 UTC 脱敏输出已留存 |
| CI / 容器 / E2E | 以对应 commit 的 GitHub Actions 为准 | `E1/E2` | `gh run view <run-id>` |

## 11. 证据索引

每个证据条目至少包含：证据 ID、执行时间（UTC）、执行人、环境、命令/工具版本、输入数据
摘要、期望结果、观察结果、状态、原始记录位置、哈希或不可变链接、复核人。

| 证据 ID | 标题 | 原始记录/报告链接 | SHA-256/报告编号 | 执行时间 | 复核人 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| EV-01 | 发布身份、SBOM、CI | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-02 | 认证、网络隔离、限流 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-03 | TLS、HSTS、响应头 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-04 | provider、预算、embedding 回退 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-05 | 迁移、兼容和应用回滚 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-06 | 生产备份与恢复 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-07 | Worker 故障注入与恢复 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-08 | 目标规模性能容量 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-09 | 可观测性、告警、Runbook | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-10 | 密钥、隐私、许可证 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |

## 12. 最终签署

| 角色 | 姓名 | 决定/签名 | 时间（UTC） |
| --- | --- | --- | --- |
| 发布负责人 | `待填写` | `GO / NO-GO` | `待填写` |
| 技术负责人 | `待填写` | `同意 / 保留` | `待填写` |
| 安全/隐私复核人 | `待填写` | `同意 / 保留` | `待填写` |
| 运维/备份负责人 | `待填写` | `同意 / 保留` | `待填写` |
| 产品负责人 | `待填写` | `同意 / 保留` | `待填写` |

证据有效期 / 下次复核日期：`待填写`

## 参考基线

本模板采用以下公开资料作为证据设计参考，不表示 WorldLoom 已获得任何认证：

- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)：安全开发、供应链和发布流程的基线。
- [OWASP Application Security Verification Standard 5.0](https://owasp.org/projects/asvs)：Web 应用和依赖环境安全控制的可验证要求；引用控制项时应固定版本。
- [Google SRE Data Integrity](https://sre.google/sre-book/data-integrity/)：区分备份与可恢复性，要求以实际恢复能力、数据完整性和可接受的数据丢失量驱动设计。
- [Google Cloud Disaster Recovery Scenarios for Data](https://docs.cloud.google.com/architecture/dr-scenarios-for-data)：RPO/RTO、恢复目标与数据库备份/日志链路的记录方式参考。
- [SLSA v1.0 Producing Artifacts](https://slsa.dev/spec/v1.0/requirements) 与 [Distributing Provenance](https://slsa.dev/spec/v1.0/distributing-provenance)：构建 provenance、制品摘要和验证链路参考。
- [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)：事件准备、检测、响应、恢复和复盘参考。
- [OpenTelemetry Logging Specification](https://opentelemetry.io/docs/specs/otel/logs/)：日志与 trace/span/request context 的关联参考。

项目自身的安全边界和门禁仍以 [DEPLOYMENT_SECURITY.md](./DEPLOYMENT_SECURITY.md)、
[ACCEPTANCE.md](./ACCEPTANCE.md) 和 [ISSUES.md](./ISSUES.md) 为准。
