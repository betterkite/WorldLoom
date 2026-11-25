# v0.1 本机单人部署与预检

2026-10-01：用户指定首发为本机单人、不开放外部访问，个人使用不设消费额度，只看累计
用量。本文件落实这个适用范围，不修改对外部署的 strict 契约，也不豁免数据恢复、内容
质量、许可或完整工程门禁。新脚本与用例仅补入源码，未执行；现运行服务未更新。

## 先确认正在使用的版本

浏览器访问的是已经启动的服务，刷新页面不会重新构建代码、替换容器或执行数据库迁移。
先查看当前地址的 `/api/health/live`，核对返回的 `version` 与准备验收的候选；该接口不访问
数据库或模型。版本号相同仍不足以证明制品完全相同，维护者还应记录对应源码和构建身份。

2026-10-26 本机有限复核时，已有 `127.0.0.1:4310` 服务返回 `version: 1.0.0`，当时仓库
候选为 `0.1.0-dev.0`。独立候选上的小样本导入、编辑和侧栏检查见
[页面验收记录](./UI_ACCEPTANCE.md#2026-10-2526-候选功能复核)。这些检查没有替换已有服务。
如果仍打开旧页面，应先确认服务版本，再安排候选升级；不要通过反复刷新或清空数据库
解决版本不一致。已有世界的升级应先保留备份，明确迁移和恢复方式，再切换 app/worker。

以下“未执行”描述保留 2026-10-01 编写时的状态；后续有限验收不等于最终安装、全部
模型功能、恢复/回退或发布已完成，也不应据此填写下文尚无实证的确认变量。

## 三种检查不能混用

| 入口 | 范围 | 不能据此声称的结果 |
| --- | --- | --- |
| `deployment:preflight` 普通模式 | 开发配置及警告，可读取本地 dotenv | 本机或对外正式发布通过 |
| `deployment:preflight:local -- --compose-config <path>` | 本机单人、无消费额度、full Compose 的离线配置/证据声明检查 | 已核实实际运行、真实模型、备份或许可；脚本不授予发布权限 |
| `deployment:preflight -- --strict` | 未来受控/对外生产契约 | 本机用户选择已替代生产认证、TLS、合同预算或相关实证 |

本机预检明确拒绝 `--strict`、未知选项、缺失输入及 `WORLDLOOM_PREFLIGHT_STRICT=true`，
不会退回普通开发模式来产生“通过”。JSON 输出为 `worldloom.local-preflight/v1`，
`releaseApproved` 永远是 false；退出码 0 仅表示所选配置与声明检查满足，1 表示阻断项，
2 表示输入/参数错误。最终发布仍以 [V0_1_RELEASE.md](./V0_1_RELEASE.md) 全部门槛为准。

## 配置输入及秘密边界

本机预检从产品 checkout 执行，读取同一目录的 `config/llm.json` 和操作者显式指定的
**解析后 Compose JSON**。不执行 Docker/项目命令，不读取隐式 `.env`/`.env.local`，不连接
数据库或 provider，不加载模型、不执行迁移，也不读取预算账本。JSON 只支持正规文件及
有限大小输入（实际字节读取也受限，不接受符号链接输入）；解析错误、凭据、连接串、
路径和文件正文均不回显。

解析后的 Compose JSON 可能含密钥和数据库密码！原始文件只能存在本机受限目录，
禁止贴入聊天、Git、公共 artifact、日志或本文件；只归档经过复核的脱敏报告。产品的
`artifacts/` 同时被 Git 和 Docker build context 忽略，仍需操作者限制其本机访问权限。
不要将低熵秘密本身的哈希作为公开证据。

待用户恢复验证，并准备可用的本地模型与相关真实记录后，才执行以下准备/预检。示例
不设置任何确认变量为 true，不启动/重建/删除容器，也不是已经执行的记录：

```bash
umask 077
mkdir -p artifacts/private
docker compose --env-file .env.local --profile full config --format json > artifacts/private/local-compose.json
pnpm deployment:preflight:local -- --compose-config artifacts/private/local-compose.json --json
```

生成 JSON 必须采用实际部署的同一 Compose 文件/override/profile/环境来源，不能用仓库
默认配置替代存在差异的运行配置。不要复制真实凭据作为测试 fixture；回归用例用合成配置。
输入声明不证明容器已经采用它，需另查当前制品和实际运行环境的安全脱敏结果。

## 配置门槛

- 所有服务的发布端口都要显式绑定字面量回环 IP。省略 host_ip、`0.0.0.0`、`::`、
  非回环地址、短端口字符串和 host/shared network mode 都不能通过。本检查不替代实际
  监听、宿主机防火墙、SSH/隧道/反向代理或 Docker daemon 外部访问检查。
- app/worker/migrate/db 声明齐全，worker 和 migrate 不发布宿主端口；app 是 Web 角色、
  worker 是独立轮询角色。app/worker 均显式设置 1–32 的进程内并发。副本数与实际资源
  消耗须另行记录，本机首发不要求制造多主机 HA 或压满内存的压力数据。
- app/worker/migrate 共用同一声明的本地 PostgreSQL 连接，避免累计统计分散到不同库。
  连接串只检查格式和一致性，不证明凭据有效、迁移完成或数据库就绪。镜像默认或显式
  NODE_ENV 必须在实际运行时确认为 production；只有显式错误值可由离线配置直接拒绝。
- app 的 canonical origin 为无凭据、无子路径/查询/片段的回环 HTTP(S) origin，端口对应
  app 的声明发布端口，worker 采用同一 origin。本机直接访问不声明外部 TLS 终止。
- 默认 LLM profile 与两个进程中的凭据变量存在；远程默认端点使用 HTTPS，本机模型
  端点只允许回环 HTTP。不探测 provider 或账户余额，默认模型超时和重试仍有资源边界。
- 个人无额度模式中，所有可选 profile 均不设置消费 limits，两进程不注入预算变量。
  **不设置**不同于显式空值或非法值；发现已有预算变量应明确处理，不删账本来“重置”。
  本预检不要求报价表或人为额度；未来其他模式保留可选 guard 和原有预算错误校验。
- 本地 embedding fallback 启用，所需 tokenizer/config 和 dtype 对应 ONNX 文件非空，
  两进程挂载相同缓存、只读，远程与本地维度一致。文件存在不代表推理成功、模型身份
  或原生组件许可正确，仍须隔离运行实证；远程 embedding 密钥不能替代本地回退证明。

源码默认 Compose origin 为 `http://127.0.0.1:4310`；直接在宿主机执行 `dev`、`start` 和
`start:worker` 也明确绑定 `127.0.0.1`。Docker standalone 在容器内仍监听 `0.0.0.0`，
由 Compose 的回环发布端口约束宿主暴露面，不能把容器内部回环与宿主绑定混淆。
这些源码默认不证明已运行的旧服务或手动命令符合边界，更新后仍须检查。

## 必须另有真实记录的声明

下列变量仅在对应版本/制品、配置及环境的记录已完成后，在**执行本机预检的进程**设置。
脚本不会自动填写，变量本身不是证据，也不能用上个候选的 PASS 冒充当前候选。

| 声明 | 对应记录 |
| --- | --- |
| `WORLDLOOM_LOCAL_NETWORK_CONFIRMED` | 实际 app/DB 仅回环、worker 无外部端口、无外部转发/隧道 |
| `WORLDLOOM_LOCAL_INSTALL_CONFIRMED` | 干净安装、迁移、模型准备及 live/ready；运行制品身份/production 环境 |
| `WORLDLOOM_LOCAL_USAGE_CONFIRMED` | 持久化累计、重试/未知 usage、跨进程重启、记录故障及局部 UI |
| `WORLDLOOM_BACKUP_RESTORE_CONFIRMED` | 可保留的真实备份/恢复点、隔离恢复、用户数据与统计完整性和恢复目标；临时演练不等于长期备份 |
| `WORLDLOOM_MIGRATION_ROLLBACK_CONFIRMED` | 迁移兼容窗口、候选应用回滚、恢复后的功能与用量影响 |
| `WORLDLOOM_WORKER_TOPOLOGY_CONFIRMED` | app/worker 实际角色、领取/恢复/幂等、总进程/副本与并发边界 |
| `WORLDLOOM_LOCAL_RESOURCE_BASELINE_CONFIRMED` | 本机正常代表性操作的内存/并发/耗时；不以额外堆叠容器压测代替 |
| `WORLDLOOM_SUPPLY_CHAIN_CONFIRMED` | 同源源码/lockfile/制品、完整分发许可、SBOM/漏洞/provenance |
| `WORLDLOOM_OBSERVABILITY_CONFIRMED` | 用量未知/缺漏、失败/陈旧任务、脱敏关联和本机恢复说明 |
| `WORLDLOOM_PRIVACY_CONFIRMED` | 秘密/用户素材不入库、provider 出站数据、导出/删除/备份边界 |

公网认证/网关限流、公共 TLS/HSTS、账户消费限额和跨主机 HA/生产规模基准在用户明确的
本机范围内记 N/A，并记录范围选择与理由；不是这些控制已通过。实际回环隔离、应用内
上传/分章/超时/并发保护、本机恢复/资源/许可/隐私仍适用。任何外部开放或改为其他消费
策略都须重新评估范围，并使用对应严格契约，不能沿用本机报告。

证据按 [DEPLOYMENT_EVIDENCE_TEMPLATE.md](./DEPLOYMENT_EVIDENCE_TEMPLATE.md) 登记真实
版本、时间、环境、期望/观察、脱敏原始记录和复核；本机是目标使用环境时应准确写本机，
不能伪造公网生产/审计事实。人工创作质量、完整 UI、同提交 CI 和发布批准仍在独立门槛中。

## 初次登记时的证据状态（历史）

脚本、参数边界、回环/角色/同库/无额度/缓存/事实声明与私有输入回归用例已编写，未运行；
没有新模型调用、迁移、浏览器检查、构建或容器操作。旧服务尚未更新。当前本机门槛仍为
未验收状态，不因为增加预检源码而标记 #3 关闭或 v0.1 完成。

同日补入本机备份演练的同快照内容比对、精确所有权/清理确认及模拟用例，见
[BACKUP_RESTORE.md](./BACKUP_RESTORE.md)。没有运行该命令或设置任何确认事实变量；
历史只比较表数/世界数的演练不能替代新用量表、真实恢复点或迁移/回滚验证。

累计统计的升级/回退源码兼容矩阵与实际证据检查表见
[LLM_USAGE_ROLLOUT.md](./LLM_USAGE_ROLLOUT.md)。live/ready 或空统计 200 不能证明
记录权限、worker 同源、完整用量或最新迁移通过；本轮只补检查表，确认变量仍不变。

## 回退兼容边界

新版允许未评分的评测记录保留 `NULL`，部分旧客户端无法读取这些记录。不得直接切回
不兼容的旧制品，也不能通过填零或删记录获取兼容。独立旧恢复点的只读维护、当前数据
保留及返回新版的步骤见[应用回退与维护恢复](./ROLLBACK_RECOVERY.md)。这条受限路径
与可写旧版回退分别验收，不能据此自动设置迁移回退确认变量。
