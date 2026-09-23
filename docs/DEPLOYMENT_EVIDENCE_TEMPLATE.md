# WorldLoom 部署证据记录模板

这份模板用于绑定严格发布门禁中的外部事实。它不是安全自证，也不替代网关、备份系统或压测平台的原始记录；完成演练后再把对应环境变量设置为 `true`，并保留外部工单或报告链接。

## 发布上下文

| 字段 | 值 |
| --- | --- |
| WorldLoom commit | `待填写` |
| 部署环境 / 区域 | `待填写` |
| 执行人 / 审核人 | `待填写` |
| 执行时间（UTC） | `待填写` |
| `NEXT_PUBLIC_APP_URL` | `待填写（只写 origin）` |
| 数据库迁移版本 | `待填写` |

## P1 发布门禁

### 网关认证与限流

- 认证方式与租户边界：`待填写`
- TLS 终止位置、HSTS 和可信转发头处理：`待填写`
- 普通 API 限流（用户/IP、窗口、burst）：`待填写`
- 长任务、摄入、导出接口的限流与并发上限：`待填写`
- 压测工具、并发量、429 比例、P95/P99：`待填写`
- 外部报告 / 工单链接：`待填写`
- 对应变量：`WORLDLOOM_GATEWAY_AUTH_CONFIRMED=true`、`WORLDLOOM_RATE_LIMIT_CONFIRMED=true`

### 生产备份与恢复

- 备份系统、保留策略和加密方式：`待填写`
- 恢复目标（独立实例 / 跨主机 / 跨区域）：`待填写`
- 恢复时间、数据校验方式、RPO/RTO：`待填写`
- 外部报告 / 工单链接：`待填写`
- 对应变量：`WORLDLOOM_BACKUP_RESTORE_CONFIRMED=true`

### 迁移回滚

- 发布前数据库备份与 schema 版本：`待填写`
- 正向迁移结果：`待填写`
- 应用回滚时的兼容窗口与验证结果：`待填写`
- 回滚后数据完整性检查：`待填写`
- 外部报告 / 工单链接：`待填写`
- 对应变量：`WORLDLOOM_MIGRATION_ROLLBACK_CONFIRMED=true`

### Worker 拓扑与故障恢复

- Web 实例数 / worker 实例数：`待填写`
- 单 worker 最大并发、数据库连接池和 provider 限流：`待填写`
- lease / heartbeat / retry budget 配置：`待填写`
- worker 中断、重启、重复投递和恢复结果：`待填写`
- 外部报告 / 工单链接：`待填写`
- 对应变量：`WORLDLOOM_WORKER_TOPOLOGY_CONFIRMED=true`

### 目标规模基准

- 目标硬件与容器资源限制：`待填写`
- entities / events / relations / sources 规模：`待填写`
- 检索 P50/P95、编译耗时、RSS、数据库连接峰值：`待填写`
- 语义索引刷新耗时与失败恢复结果：`待填写`
- 外部报告 / 工单链接：`待填写`
- 对应变量：`WORLDLOOM_TARGET_SCALE_CONFIRMED=true`

## Provider 预算

- provider / model：`待填写`
- 价格核对日期（UTC）与官方链接：`待填写`
- 账户额度或合同上限：`待填写`
- `maxInputTokensPerRun`：`待填写`
- `maxOutputTokensPerRun`：`待填写`
- `maxEstimatedCostUsdPerRun`：`待填写`
- 严格 preflight 输出（不得包含凭据）：`待填写`

## 留痕规则

- 不提交 API key、数据库密码、用户素材、provider 原始响应或可识别个人信息。
- 仓库只保存脱敏摘要和外部记录链接；原始报告放在部署方受控系统。
- 完成后运行 `pnpm deployment:preflight -- --strict`；承诺语义检索时追加 `--require-semantic`。
