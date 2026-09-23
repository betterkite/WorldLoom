+# WorldLoom 项目评测与架构说明

## 系统定位

WorldLoom 将非结构化创作素材转换为可审阅、可检索、可回放的世界知识。系统的核心不是一次
生成，而是把生成结果放入可追踪的变更流中，经过审阅后再进入不可变版本。

## 运行链路

```text
素材/章节
  ↓
CompileRun（分块、checkpoint、用量与心跳）
  ↓
Change（待审变更，带来源与候选快照）
  ↓
人工审阅 / lint
  ↓
事务内 merge
  ↓
WorldVersion（不可变正史）
  ↓
检索、问答、图谱、时间线、推演与导出
```

合并时使用世界级 advisory lock，并在锁内重新读取最新状态。相同 kind、uid、payload 的
重复变更幂等去重；payload 不同的并发变更记录冲突。删除保留墓碑，回滚创建新的前拷贝版本。

## 代码结构

| 路径 | 职责 |
| --- | --- |
| `src/app` | App Router 页面和 API 路由 |
| `src/features/worlds` | 世界、素材、编年史、创作台和治理页面 |
| `src/features/evals` | 检索和答案评测界面 |
| `src/features/skills` | 技能管理、导入和版本操作 |
| `src/lib/governance` | 变更合并、版本、冲突和墓碑 |
| `src/lib/worldbuilding` | 编译、编年史、lint、推演和领域逻辑 |
| `src/lib/retrieval` | 词法/语义检索、RRF、引用和索引任务 |
| `src/lib/graph` | 图谱节点、边和时间切片数据 |
| `src/lib/intake` | 文件、URL、PDF、EPUB 和章节切分 |
| `src/lib/llm` | OpenAI-compatible provider、usage 和预算保护 |
| `src/lib/worker` | CompileRun 与 SemanticIndexJob 的任务执行 |
| `src/lib/export`、`src/lib/mcp` | 导出与 MCP 集成 |
| `prisma` | PostgreSQL/pgvector 数据模型和迁移 |
| `config` | LLM profile 与运行配置 |
| `e2e`、`tests`、`scripts` | 浏览器、单元/集成测试和运维检查 |

## 关键数据边界

- `Change` 是 LLM 与正史之间的唯一写入边界。
- `WorldVersion` 只追加，不原地修改。
- `CompileChunk` 是长文本恢复和幂等的边界。
- `SemanticIndexJob` 记录向量索引的状态、模型身份和失败原因。
- `QaRecord` 保留回答、引用和检索模式，不保存 provider 原始响应正文。
- `.cache/worldloom-embeddings/` 是运行时缓存，不提交到 Git。

## 当前评测结论

代码层面已覆盖世界生命周期、编译、审阅合并、检索问答、图谱时间切片、创作台、评测、
导出、MCP、迁移和容器启动链路。后续最重要的工作不是继续堆功能，而是补齐部署方的
认证/限流压测、生产备份恢复与迁移回滚、独立 worker 拓扑验证，并用真实创作素材验证生成
质量、耗时和成本。

## 维护建议

1. 修改领域模型时同步更新 Prisma 迁移、API 契约、测试和导出格式。
2. 修改编译或合并逻辑时同时验证失败恢复、并发冲突、来源引用和预算边界。
3. 修改检索时同时验证词法、语义、本地回退、引用完整性和无证据回答。
4. 发布前运行 README 与部署安全契约中的门禁；公网部署还需由部署方提供外部安全证据。
