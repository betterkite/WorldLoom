# WorldLoom 验收标准

本文档描述当前版本的可重复验收范围，不记录历史项目或开发过程档案。

首版 v0.1 的支持范围、完成条件及发布顺序见 [V0_1_RELEASE.md](./V0_1_RELEASE.md)。

## 功能验收

| 类别 | 必须证明的行为 | 证据 |
| --- | --- | --- |
| 世界治理 | 创建世界、生成变更、审阅、合并、版本和回滚 | API/集成测试 |
| 编译 | 文本分块、失败恢复、取消、来源引用、用量记录与[版本一致性](COMPILE_RUNS.md) | runner/并发快照测试与真实链路 |
| 创作台 | 导入、自动分章、编辑、定稿、推演、伏笔和回编译 | 浏览器 E2E |
| 时间线 | 纪元排序、虚构日期、因果边和关系状态 | API/UI 验收 |
| 图谱 | 三视图、类型编码、详情、邻居、布局和时间切片 | WebGL 或 SVG 兼容渲染/UI 验收 |
| 检索问答 | 词法、语义、本地 embedding 回退、RRF、引用和无证据声明 | 检索/问答测试 |
| 评测 | 检索命中率、答案裁判、固定版本、无沉淀/合并副作用、未评分与有效数、榜单 | 评测测试；语义见 [评测说明](EVALUATIONS.md) |
| 输出 | Obsidian ZIP、游戏 JSON、MCP 三个工具 | 导出/API 测试 |
| 运行治理 | health、任务状态、错误脱敏、worker 和预算门禁 | API/部署测试 |

## 工程门禁

```bash
pnpm format:check
pnpm typecheck
pnpm lint:strict
pnpm test
pnpm build
pnpm run audit
pnpm e2e
pnpm license:audit
```

数据库相关验收需要 PostgreSQL 16 + pgvector，并执行 `pnpm db:deploy`。语义增强验收前执行
`pnpm embeddings:download`；远程 embedding 不可用时，应确认本地模型仍能完成索引，且健康
接口不展示 provider 余额。

真实模型使用 `node scripts/acceptance.mjs [baseUrl]`，默认只创建并清理本次 UUID fixture；
`--keep-world` 可明确保留供人工内容复核，完成后核验精确 ID 再清理。默认模型未就绪时不创建
世界；请求和轮询有期限，编译失败/超时会请求取消自身任务，失败清理也计入退出码。
自动化通过不代替内容质量批准。合成样本的实际结果和失败历史见
[REAL_MODEL_ACCEPTANCE.md](./REAL_MODEL_ACCEPTANCE.md)。

## 发布验收

- `docker compose --profile full config --quiet` 通过。
- migration 服务成功后应用才启动。
- `/api/health/live` 不访问数据库或外部 provider；`/api/health/ready` 确认 PostgreSQL，Docker liveness 不调用模型诊断接口。
- 默认端口仍绑定回环地址；公网部署另行完成认证、TLS、限流和备份恢复演练。
- 本机单人无消费额度首发按 [LOCAL_DEPLOYMENT.md](./LOCAL_DEPLOYMENT.md) 运行独立 `deployment:preflight:local` 并保留适用运行证据；普通开发预检不作发布通过。对外/受控生产部署仍在解析后的实际环境运行 `pnpm deployment:preflight -- --strict`；strict 不自动读取 `.env.local`，承诺语义增强时再加 `--require-semantic`。
- Full Compose 本地 Worker 验收应同时运行 `pnpm worker:smoke` 和 `pnpm worker:recovery-smoke`，分别证明 queued 领取与 stale heartbeat 恢复；两者均不替代生产故障注入和容量证据。
- 真实 worker 中断和双副本重投只在 [专用临时环境](./WORKER_DRILL.md) 执行；脚本无默认项目，并要求实际数据库/容器隔离和清理通过。现有用户服务不属于演练范围。
- app/worker/migrate 的实际 OCI 制品须通过项目与上游 UI 许可校验、运行时依赖 `--strict` 许可审计、无密钥检查和完整 CI；原生组件、浏览器 bundle 与基础镜像的分发义务须由合格人员复核。本机候选通过部分检查不构成发布批准。
- 生产环境完成真实 provider、目标规模检索/编译、迁移回滚和 worker 拓扑验证。
