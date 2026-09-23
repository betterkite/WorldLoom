+# WorldLoom 验收标准

本文档描述当前版本的可重复验收范围，不记录历史项目或开发过程档案。

## 功能验收

| 类别 | 必须证明的行为 | 证据 |
| --- | --- | --- |
| 世界治理 | 创建世界、生成变更、审阅、合并、版本和回滚 | API/集成测试 |
| 编译 | 文本分块、失败恢复、取消、来源引用和用量记录 | runner 测试与真实链路 |
| 创作台 | 导入、自动分章、编辑、定稿、推演、伏笔和回编译 | 浏览器 E2E |
| 时间线 | 纪元排序、虚构日期、因果边和关系状态 | API/UI 验收 |
| 图谱 | 三视图、类型编码、详情、邻居、布局和时间切片 | WebGL/UI 验收 |
| 检索问答 | 词法、语义、本地 embedding 回退、RRF、引用和无证据声明 | 检索/问答测试 |
| 评测 | 检索命中率、答案裁判、不可解析评分不造分、榜单 | 评测测试 |
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

## 发布验收

- `docker compose --profile full config --quiet` 通过。
- migration 服务成功后应用才启动。
- 默认端口仍绑定回环地址；公网部署另行完成认证、TLS、限流和备份恢复演练。
- `pnpm deployment:preflight -- --strict` 通过；承诺语义增强时再加 `--require-semantic`。
- 生产环境完成真实 provider、目标规模检索/编译、迁移回滚和 worker 拓扑验证。
