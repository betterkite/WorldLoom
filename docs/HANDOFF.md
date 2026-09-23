# WorldLoom 维护者说明

本文档只描述当前 WorldLoom 的架构、运行边界和接手入口。

## 上手

```bash
pnpm install
docker compose up -d
cp .env.example .env.local
pnpm db:deploy
pnpm dev
```

需要语义检索时执行 `pnpm embeddings:download`。默认 LLM profile 在 `config/llm.json` 中，
凭据只放在被 Git 忽略的 `.env.local`。

## 先看哪里

- 产品范围和不变量：`docs/REQUIREMENTS.md`
- 架构与模块职责：`docs/PROJECT_REVIEW.md`
- 当前发布问题：`docs/ISSUES.md`、`docs/BACKLOG.md`
- 部署安全边界：`docs/DEPLOYMENT_SECURITY.md`
- 图谱实现约束：`docs/GRAPH_ENGINE.md`
- 验收命令：`docs/ACCEPTANCE.md` 和根目录 `README.md`

## 不可破坏的不变量

- LLM 产物必须先成为 `Change`，不能直接写入正史。
- `WorldVersion` 只追加；回滚创建新版本。
- 世界级合并需要事务锁，并在锁内重新读取最新状态。
- 编译按块持久化，失败或取消不能半写正史；恢复只继续未完成块。
- 章节切片不超过 20,000 字，导入和编辑两条路径都要校验。
- 远程 embedding 失败回退本地模型，再失败才降级词法检索。
- 不完整 usage 不能被当作完整用量；未知价格不能被当作零成本。
- 任何错误响应、日志、健康摘要和导出都不得泄露凭据或上游原文。

## 修改后的验证顺序

1. 先运行目标模块的单元/集成测试。
2. 修改数据库模型后生成迁移，并在干净数据库执行 `pnpm db:deploy`。
3. 运行 `pnpm typecheck`、`pnpm lint:strict`、`pnpm build` 和 `pnpm test`。
4. 涉及页面时运行对应 Playwright E2E 和 `pnpm run audit`。
5. 发布前运行 `pnpm deployment:preflight -- --strict`，必要时追加 `--require-semantic`。

## 运行边界

当前 worker 模式面向单实例或受控主机。公网部署必须由外部网关提供认证、TLS、限流和日志
关联，并由部署方完成备份恢复、迁移回滚、目标规模压测和 worker 拓扑验证。
