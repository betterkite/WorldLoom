# WorldLoom 当前问题登记

这里只登记当前项目仍需处理的事项；不纳入开发过程聊天记录。

| 编号 | 优先级 | 问题 | 验收条件 | 状态 | GitHub issue |
| --- | --- | --- | --- | --- | --- |
| ISS-30 | P1 | 部署安全证据仍依赖部署方 | 外部认证、限流压测、生产备份恢复、迁移回滚和目标规模压测均有记录 | 模板 v1.4 增补部署范围/信任边界、控制责任/例外、身份生命周期、API 滥用防护、漏洞披露闭环、provider 数据处理、加密/密钥轮换及 OWASP LLM 风险验证；外部认证、生产备份恢复、迁移回滚、目标容量等实证仍待部署方提供 | [#1](https://github.com/betterkite/WorldLoom/issues/1) |
| ISS-31 | P1 | 独立 worker 拓扑尚未做生产级验证 | lease、并发上限、重试预算、故障恢复和幂等写入通过演练 | 已加 3 次 stale recovery 上限；2026-09-23 UTC 本地 full Compose 复测通过 queued claim、本地 `Xenova/bge-m3` 成功索引、stale lease 恢复及 64 条目 SIGKILL/restart 幂等演练（64 向量、无重复）；CI run [35903165178](https://github.com/betterkite/WorldLoom/actions/runs/35903165178) 验证两个不同 Compose worker 副本分别领取独立队列任务（每项 1 次尝试），DB 并发 CAS 集成测试通过。CI 空 fixture 不执行 provider；生产 HA、全局并发预算、容量/SLO 和目标部署环境故障演练仍待完成 | [#2](https://github.com/betterkite/WorldLoom/issues/2) |
| ISS-32 | P1 | 正式 provider 的价格与预算值需要按部署合同填写 | 严格 preflight 通过，预算/告警值与合同或批准额度一致 | 已加 90 天价格证据门禁、CompileRun 持久化 guard 和其他 LLM 操作级累计软 guard（CI 35898154828 通过）；真实批准 limits、账户级硬额度/告警及正式严格 preflight 仍待部署方提供 | [#3](https://github.com/betterkite/WorldLoom/issues/3) |
| ISS-33 | P2 | 真实创作质量仍需持续观察 | 连续真实素材试用形成质量、耗时、成本和阻塞记录 | 暂缓 | [#4](https://github.com/betterkite/WorldLoom/issues/4) |
| ISS-34 | P2 | 大规模检索需要按目标硬件复测 | 目标数据量下 P95、内存和索引刷新满足部署门槛 | 2026-09-23 UTC 在本机 Mac17,5 复测 500 entities + 2000 events：12 queries P95 66.3ms；Docker stats 3 个快照显示 app 251.0 MiB、DB 83.9 MiB、预热本地 embedding worker 1560.6 MiB。仅本机开发基线，采样稀疏且无目标硬件/数据量及获批 SLO 阈值，目标容量仍未验证 | [#5](https://github.com/betterkite/WorldLoom/issues/5) |
| ISS-35 | P2 | 图谱高级交互尚未启用 | 路径查找、聚类折叠和类型筛选有明确 UX 与回归测试 | 已完成（649803ca） | [#6](https://github.com/betterkite/WorldLoom/issues/6) |

新增问题应写明复现条件、影响范围、验收条件和优先级；不要把凭据、用户素材或 provider
原始响应写入 issue 或仓库。

ISS-35 已在 `649803ca` 完成：图谱支持当前筛选范围内的最短路径、总览社区折叠和节点类型筛选；
纯逻辑测试 3 项通过，生产浏览器验收 41 项通过（FAIL 0、WARN 0）。
