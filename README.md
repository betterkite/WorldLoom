# WorldLoom

**世界观与编年史创作工作室** —— 从种子设定或半成品文稿出发，用 LLM 编译出结构化、自洽、持续演进的世界观与编年史。

> 需求、架构和发布约束见 [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)、
> [docs/PROJECT_REVIEW.md](./docs/PROJECT_REVIEW.md) 和
> [docs/DEPLOYMENT_SECURITY.md](./docs/DEPLOYMENT_SECURITY.md)。

## 功能

- **世界编译**：两步 LLM 管线（分析 → 生成）把章节文本编译成纪元 / 条目 / 事件 / 关系变更；名称引用由服务端解析为稳定 uid，坏 JSON 与截断输出有修复与缺陷记录
- **版本治理**：每次合并生成不可变 `WorldVersion`；并发冲突进账本（latest-wins），删除留墓碑，回滚是旧版本的前拷贝——历史只增不改
- **审阅链**：所有 LLM 产物先落「待审变更」，人工审阅后合并入正史；同名条目的重复 upsert 自动去重，不误报冲突
- **编年史与时间线**：纪元分段、虚构历法排序、因果边连线、关系时间切片回放（任意事件时刻的关系状态着色）
- **世界知识助手**：词法（CJK bigram BM25）+ 语义（pgvector）+ RRF 融合的混合检索；回答逐条带引用，证据不足时如实声明，零证据会改写问题重试。检索语料包含条目、事件与关系快照
- **故事创作台**：半成品批量导入与自动分章、章节编辑与定稿回编译、进度光标、推演候选（采纳/忽略）、伏笔埋设与回收
- **图谱**（Reagraph WebGL，自动兼容降级）：关系图/因果图/总览三视图，节点按类型着色、节点详情侧边栏、ego 邻居、时间切片着色、多布局切换（力导向/环形/同心/层次/放射）、推断相关边可开关；WebGL 不可用时保留可交互 SVG 图谱
- **评测平台**：检索命中率基准 + LLM 答案评测（裁判按评分要点打分，无法解析的评审不编造分数），答案榜单按均分排序
- **输出与集成**：Obsidian 镜像 ZIP（含 timeline.md）、游戏引擎 JSON、MCP Server（`query_world` / `compile_source` / `lint_world`）

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript 5.7 · Tailwind 4 + shadcn/ui · TanStack Query/Table · **Reagraph（WebGL 图谱）** · Prisma 6 + PostgreSQL 16 + pgvector · Vitest 4 · Playwright

## 快速开始

前置：Node 24、pnpm 11、Docker。

```bash
pnpm install
docker compose up -d            # PostgreSQL 16 + pgvector（宿主端口 43133）
cp .env.example .env.local      # 填入模型凭据（见下）
pnpm db:deploy                  # 应用迁移
pnpm dev                        # http://localhost:4310
```

首次使用：在「世界列表」新建世界 → 用「创世向导」生成骨架，或到「素材 / 作品」导入半成品文稿 → 编译 → 到「审阅」合并入正史。

## 模型接入与凭据

- `config/llm.json` 声明锁定的 profile（OpenAI 兼容端点、模型、超时、凭据环境变量名），默认 `deepseek-official`
- 凭据只写进被 git 忽略的 `.env.local`，变量名与 profile 的 `credentialEnv` 一一对应（如 `DEEPSEEK_API_KEY`）
- 语义检索：默认使用本地缓存的 `Xenova/bge-m3`（1024 维、ONNX int8）；可选优先调用 OpenAI-compatible Embedding 端点，端点未配置或失败时自动回退本地模型，远程和本地都不可用时才降级为纯词法检索，不报错
- 价格与预算：`config/llm.json` 的 profile 可填写 provider 价格及每次 CompileRun 的 input/output token、估算美元上限；未明确配置的值保持 `null`，未知价格不会被猜测
- `GET /api/health` 报告各 profile 的配置与连通状态（含语义检索就绪状态），不回显任何凭据

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` / `pnpm start:worker` | 开发 / 构建 / 生产 Web / 受控 DB worker 启动（端口 4310） |
| `pnpm typecheck` · `pnpm lint` | 类型检查 · 静态检查（oxlint） |
| `pnpm embeddings:download` | 下载本地 `Xenova/bge-m3` embedding 模型到被忽略缓存 |
| `pnpm test` | 单元与集成测试（Vitest，需数据库） |
| `pnpm e2e` | 真实浏览器端到端旅程（Playwright，需已 build 并可访问服务） |
| `pnpm run audit` | 全量可用性审计：治理链播种 + 全部 API + 全部页面（50 项 PASS/FAIL） |
| `node scripts/ui-shots.mjs` · `node scripts/ui-acceptance.mjs` | 页面验收：播种演示世界 + 全页截图 · 程序化 UI 验收（结构/几何/可达性/渲染证据/交互） |
| `pnpm benchmark:retrieval [url]` | 固定规模检索基准：500 entities + 2000 events，输出 P50/P95/最大耗时与 RSS 变化并自动清理临时世界 |
| `pnpm db:backup:drill` | 在临时数据库执行 custom-format PostgreSQL 备份/恢复演练并自动清理，不替代生产备份系统 |
| `pnpm deployment:preflight -- [--strict] [--require-semantic]` | 发布前配置检查；严格模式默认校验词法检索版，只有承诺语义增强版时才追加 `--require-semantic`；且不回显凭据 |
| `pnpm acceptance [url]` | 真实模型全链路验收（创世 → 编译 → Lint → 问答 → 推演 → 导出 → MCP） |
| `pnpm db:generate` · `pnpm db:deploy` · `pnpm db:migrate` · `pnpm db:reset` | Prisma 客户端 / 迁移部署 / 迁移开发 / 重置 |

> 注意：`pnpm audit`（不带 `run`）是 pnpm 内置的依赖漏洞扫描；本项目审计脚本是 `pnpm run audit`。

## 部署

```bash
DEEPSEEK_API_KEY=... docker compose --profile full up -d --build
```

`--profile full` 会构建并启动应用容器和不暴露宿主端口的独立 worker 容器（均为 Next standalone
镜像；worker 通过 `WORLDLOOM_WORKER=true` 启动 DB 任务轮询）；数据库健康后先运行一次性
`prisma migrate deploy`，迁移失败时应用和 worker 都不会启动。镜像不含凭据，凭据由环境注入；容器内默认使用
`db:5432`，如需自定义连接串请设置 `WORLDLOOM_CONTAINER_DATABASE_URL`，不要把宿主机的
`DATABASE_URL=...localhost...` 直接传入容器。
本地 embedding 模型不提交进镜像；需要语义索引时，请在部署镜像构建/启动前执行
`pnpm embeddings:download`，或将 `.cache/worldloom-embeddings/` 挂载到应用容器。
Compose 端口默认只绑定 `127.0.0.1`，适合本机/受控主机使用；若要对外提供服务，必须另行配置反向代理、身份认证、TLS、限流与备份策略，本项目默认配置不提供公网多租户安全边界。

项目以 MIT 许可证开源。默认配置适合本地或受控主机；公网部署前请完成认证、限流、TLS、备份和恢复演练。

## 架构要点

```
World（世界）
├── Source / Manuscript / Chapter          素材与章切片（每片 ≤2 万字）
├── Compile → Change（待审变更）→ merge → WorldVersion（不可变快照）
│     ├── Entity / Epoch / ChronicleEvent / EventEdge / RelationshipEvent
│     └── ConflictRecord（并发与过期基版本账本）· Tombstone（删除审计）
├── LintFinding（7 条一致性规则）· Foreshadow（伏笔）
├── Skill（助手/编译作用域技能）· QaRecord（问答与引用）
└── EvalCase / EvalRun（检索命中率 + LLM 答案评测）
```

所有 LLM 产物只能以 `Change` 形式进入审阅队列；合并由 governance 引擎按世界串行化（事务内 advisory lock），版本只增不改、可回滚。

## 质量门禁与验收

| 门禁 | 内容 |
| --- | --- |
| `pnpm test` | 单元与集成测试（覆盖治理、编译、编年史、检索、创作台、图谱时间切片、并发合并、答案评测） |
| `pnpm e2e` | 浏览器旅程：世界生命周期 + 作品导入与评测跑分 |
| `pnpm run audit` | 50 项可用性审计（全部 API 与页面路由） |
| `pnpm benchmark:retrieval` | 500 entities + 2000 events 的固定规模检索基线；部署到不同硬件后必须重跑 |
| `pnpm acceptance` | 真实模型 16 步全链路验收 |
| CI | `.github/workflows/ci.yml`：`verify`（typecheck / lint / test / build）+ `e2e`（Postgres service + Playwright，失败上传报告）+ `container`（Compose 图校验、migration 镜像和 production 镜像构建） |

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/ACCEPTANCE.md](./docs/ACCEPTANCE.md) | 六阶段验收标准与证据 |
| [docs/ISSUES.md](./docs/ISSUES.md) | 功能验收台账与缺陷登记（ISS-XX） |
| [docs/BACKLOG.md](./docs/BACKLOG.md) | 遗留任务与优先级 |
| [docs/PROJECT_REVIEW.md](./docs/PROJECT_REVIEW.md) | 架构与功能全貌梳理 |
| [docs/GRAPH_ENGINE.md](./docs/GRAPH_ENGINE.md) | 图谱引擎选型记录（含 Neo4j NVL 许可证限制） |
| [docs/UI_ACCEPTANCE.md](./docs/UI_ACCEPTANCE.md) | 页面验收记录（程序化检查矩阵） |
| [docs/HANDOFF.md](./docs/HANDOFF.md) | 维护者上手、架构边界和验证入口 |
| [docs/DEPLOYMENT_SECURITY.md](./docs/DEPLOYMENT_SECURITY.md) | **生产部署安全契约**（认证、限流、任务 worker、迁移、备份与上线门禁） |
| [docs/DEPLOYMENT_EVIDENCE_TEMPLATE.md](./docs/DEPLOYMENT_EVIDENCE_TEMPLATE.md) | 部署方外部证据记录模板（不含凭据） |
| [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md) | 需求文档（PRD） |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | 第三方代码与依赖的开源归属、许可盘点 |

## 许可

[MIT](./LICENSE)
