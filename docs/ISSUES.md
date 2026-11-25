# WorldLoom 当前问题登记

这里只登记当前项目仍需处理的事项；不纳入开发过程聊天记录。

| 编号 | 优先级 | 问题 | 验收条件 | 状态 | GitHub issue |
| --- | --- | --- | --- | --- | --- |
| ISS-30 | P1 | 部署安全证据仍依赖部署方 | 外部认证、限流压测、生产备份恢复、迁移回滚和目标规模压测均有记录 | 部署证据模板 v1.7 增加 ISO/IEC 27001/27002、27701、42001 与 SOC 2 TSC 的条件性映射，仅定义要求而非认证。2026-09-24 本机 Compose app/worker/migrate 非 root、app/worker 只读根文件系统、capabilities 全丢弃、no-new-privileges/PID 上限和受限 tmpfs 已验证；2026-09-27 在保存数据库 dump 与旧镜像回滚 tag 后，本机回环地址 4310 app/worker 换新镜像，live/ready 200、均 healthy，未改 schema。生产编排 probe、外部认证、生产备份恢复、迁移回滚、目标容量与宿主机/CIS 全量核验仍待部署方提供 | [#1](https://github.com/betterkite/WorldLoom/issues/1) |
| ISS-31 | P1 | 独立 worker 拓扑尚未做生产级验证 | lease、并发上限、重试预算、故障恢复和幂等写入通过演练 | 已加 3 次 stale recovery 上限；2026-09-23 UTC 本地 full Compose 复测通过 queued claim、本地 `Xenova/bge-m3` 成功索引、stale lease 恢复及 64 条目 SIGKILL/restart 幂等演练（64 向量、无重复）；CI run [35903165178](https://github.com/betterkite/WorldLoom/actions/runs/35903165178) 验证两个不同 Compose worker 副本分别领取独立队列任务（每项 1 次尝试），DB 并发 CAS 集成测试通过。2026-09-27 新 worker 镜像的两个本机副本在隔离临时库各自领取 1 个空任务，attempts=1，未调用 provider；仅为顺序隔离验证，不证明同时竞争。生产 HA、全局并发预算、容量/SLO 和目标部署环境故障演练仍待完成 | [#2](https://github.com/betterkite/WorldLoom/issues/2) |
| ISS-32 | P1 | 正式 provider 的价格与预算值需要按部署合同填写 | 严格 preflight 通过，预算/告警值与合同或批准额度一致 | 已加 90 天价格证据门禁、CompileRun 持久化 guard 和其他 LLM 操作级累计软 guard（CI 35898154828 通过）；strict 预检默认不读取 `.env.local`，只检查继承环境或显式 `--runtime-env-file`。2026-09-27 单次有界 8-token DeepSeek 本机请求 HTTP 200；随后本机 4310 Compose app/worker 已按 `.env.local` 注入凭据，健康诊断显示 LLM configured/detected=true。账户级硬额度/告警、获批 limits 和正式部署严格预检仍待部署方提供 | [#3](https://github.com/betterkite/WorldLoom/issues/3) |
| ISS-33 | P2 | 真实创作质量仍需持续观察 | 连续真实素材试用形成质量、耗时、成本和阻塞记录 | 2026-09-30 隔离库 DeepSeek 合成闭环第二轮 19 项检查通过、117.6 秒，本地语义回退与版本 v1→v4 验证；首轮语义步骤异常仍记入风险，非编译全链路成本与代表性素材人工批准仍缺。见 [真实模型证据](./REAL_MODEL_ACCEPTANCE.md) | [#4](https://github.com/betterkite/WorldLoom/issues/4) |
| ISS-34 | P2 | 大规模检索需要按目标硬件复测 | 目标数据量下 P95、内存和索引刷新满足部署门槛 | 2026-09-23 UTC 在本机 Mac17,5 复测 500 entities + 2000 events：100 个串行查询 P95 48.7ms、max 67.0ms；Docker stats 流 6.01s、每容器 9 个快照，app sampled peak 370.4 MiB、DB 59.8 MiB、已加载本地 embedding worker 1315.8 MiB。仅本机开发基线，采样值非高水位，且无目标硬件/数据量及获批 SLO 阈值，目标容量仍未验证 | [#5](https://github.com/betterkite/WorldLoom/issues/5) |
| ISS-35 | P2 | 图谱高级交互尚未启用 | 路径查找、聚类折叠和类型筛选有明确 UX 与回归测试 | 已完成（649803ca） | [#6](https://github.com/betterkite/WorldLoom/issues/6) |
| ISS-36 | P1 | 发布容器缺少项目与上游 UI 许可声明 | app/worker/migrate 制品携带适用声明，并由构建与 CI 校验 | 本地候选镜像校验通过；远端 CI 未运行，#11 运行时依赖门禁仍失败 | [#7](https://github.com/betterkite/WorldLoom/issues/7) |
| #8 | P1 | 失效世界深链触发全局错误且侧栏不可用 | 404 恢复页和窄窗口导航的真实浏览器回归通过 | 2026-09-27 本机 4310 Compose 已换新镜像，Chromium 10/10、Edge 窄窗口 404 恢复/侧栏回归通过；远端 CI 与目标部署验收未运行 | [#8](https://github.com/betterkite/WorldLoom/issues/8) |
| #9 | P1 | 容器存活探针调用外部模型诊断 | live 不访问 DB/provider，ready 正确反映 DB，OCI HEALTHCHECK 与 CI 验证 | 本地候选镜像正/负向探针通过；2026-09-27 本机 4310 Compose live/ready 均 200、app/worker healthy；远端 CI 与目标部署未验证 | [#9](https://github.com/betterkite/WorldLoom/issues/9) |
| #10 | P1 | 侧栏残留虚假账户与通知入口 | 移除假入口并覆盖桌面/窄窗口可达性 | 2026-09-27 本机 4310 Compose Chromium/Edge 回归及 42/42 页面验收通过；远端 CI 与目标部署未运行 | [#10](https://github.com/betterkite/WorldLoom/issues/10) |
| #11 | P1 | 运行时依赖许可与原生组件归属未闭合 | 严格镜像审计、完整制品清单与合格人员复核均通过 | 9/30 两架构候选已补 ONNX 完整第三方告知及 libvips 组件告知；余 `client-only` 1 个邻接 notice 缺口，完整原生许可/分发义务仍未闭合，严格审计失败 | [#11](https://github.com/betterkite/WorldLoom/issues/11) |
| LOCAL-20260930-01 | P1 | 命令面板 React peer 不匹配、世界占位地址与快捷键冲突；列表故障触发全局错误 | React 19 兼容声明、有效世界导航、桌面/窄屏键盘焦点与错误重试回归 | 本地迁移 cmdk，共用已验证世界导航；请求失败/非法响应改为局部重试。241 项工程测试、Chromium/Edge 各 16 项 E2E 和截图抽查通过；未提交/发布 | 本地 issue 草稿，未冒用远端编号 |

新增问题应写明复现条件、影响范围、验收条件和优先级；不要把凭据、用户素材或 provider
原始响应写入 issue 或仓库。

本地 issue 草稿 `LOCAL-20260930-03`（P1）：前端单章/批量编译误读 finalize 的
`run.totalChunks`，可能显示 undefined/NaN；批量提交错误被吞掉且 0 确认提交仍提示成功。
已共用严格响应解析，显示未确认提交数，0 确认不提示成功；40 文件/289 项、类型、strict
lint、格式与隔离生产构建通过，新镜像/浏览器编译复验仍待完成。代表性长篇文件已从真实
前端 chooser 导入 51 片（无全局崩溃），这不是全文模型编译通过。后续还需核对 mixed
divider/标题、API 与 worker 总进程并发和压力测试累计费用，不能直接用旧 E2E 冒充新证据。

10/1 LOCAL-20260930-03 更新：用户取消压力测试，改为低资源的大文本适用性。装饰 divider
覆盖章节和长章标题丢失已修复；解析 78 片且规范化内容逐字覆盖。新增目录摘要与按章正文
GET，避免浏览作品时载入全部正文；保留完整 API 兼容和世界归属检查。导入错误不清空输入，
大文件 base64 不再整块 spread。44 文件/312 项常规测试通过，新界面 E2E 已补但尚未运行；
不宣称全面恢复/幂等、模型质量或最新正式镜像已验收。隔离压力容器和网络已删除，0 付费调用。

2026-09-30 #2 补充：专用 tmpfs 数据库、显式随机项目及实际容器/DB 身份保护已补入
`worker:chaos-smoke`。arm64 候选真实 SIGKILL/lease 恢复/同任务重投通过（128 条、attempts
1→2→3、recoveryAttempts=1）；两副本同时在线的 64 条任务首次 attempts=1、重投后=2，
向量完整且唯一。两场景均确认 fixture、容器和网络清理；原有服务未重启，5 个用户世界不变。
39 文件/278 项工程测试通过，含受控并发 CAS、恢复预算和 executor 错误脱敏。复现及边界见
[WORKER_DRILL.md](./WORKER_DRILL.md)；目标容量、跨主机/滚动发布及 provider 账户预算仍待验收。

ISS-35 已在 `649803ca` 完成：图谱支持当前筛选范围内的最短路径、总览社区折叠和节点类型筛选；
纯逻辑测试 3 项通过，生产浏览器验收 41 项通过（FAIL 0、WARN 0）。
