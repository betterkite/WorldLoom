# WorldLoom 部署证据包模板

本文件用于记录一次具体发布的可审计证据。它不是安全自证、合规认证或生产备份本身；每个
`PASS` 都必须能由部署方提供可复核的原始记录、命令输出、监控截图/导出、工单或报告链接。
没有证据时必须写 `PENDING`，不得仅因为环境变量被设置为 `true` 就判定通过。

**模板版本：** `1.3`　**适用范围：** WorldLoom 单次发布/变更　**默认时区：** UTC<br>
**证据保管人：** `待填写`　**批准记录：** `待填写`　**最近修订：** `2026-09-24`

**本版修订：** 增加标准/实践基线到证据的映射、发布 SLI/SLO 与量化停止/回滚阈值、部署配置身份及
数据库迁移兼容性证据；修正 SLSA v1.2 规范链接。此修订不代表项目已满足这些基线。

## 使用边界

- 本模板覆盖 WorldLoom 应用、PostgreSQL/pgvector、反向代理、LLM provider、embedding 回退和
  DB worker 的一次发布验收。
- 本仓库中的本地测试、CI 和容器演练最多证明 `E1`/`E2` 级别；它们不能替代生产网关、生产
  备份恢复、目标硬件压测或独立 worker 故障演练。
- 不在仓库或本文件记录 API key、数据库密码、原始用户素材、完整 provider 响应、个人信息或
  未脱敏的日志。外部证据只记录受控系统链接、报告编号和摘要哈希。
- 若控制项不适用，必须写明理由、风险接受人和复核日期，不能留空。
- 发布证据按“原始记录、派生摘要、复核决定”分层保存；派生摘要不能替代原始记录。
- 所有时间统一记录为 UTC；执行人、自动化身份和复核人必须可追溯到组织身份或变更系统账号。
- 证据链接应使用不可变版本、运行 ID、报告编号或对象版本；只给可变的首页、截图或 mutable tag 不足以支持审计。
- 本模板中的“必须/不得”是发布门禁要求，“应”是默认控制，“可”表示在记录理由后允许的实现选择；如组织政策更严格，以组织政策为准。

## 0. 证据包治理与可验证性

证据包本身也是受控交付物。截图只能作为辅助材料；涉及发布身份、镜像、迁移、备份、压测和
安全控制的结论，必须优先提供机器可读原始记录、不可变链接或带校验和的报告。

每个 `EV-*` 至少登记以下元数据：

| 字段 | 要求 |
| --- | --- |
| 证据 ID / 控制目标 | 与第 11 节索引和发布决策总表一一对应；不得复用 ID |
| 基线条款 / 版本 | 记录框架全名、版本和精确条款编号；不适用时记理由，不得仅引用框架首页 |
| 状态 / 证据等级 | 只能使用本文规定的状态和 `E0`–`E4` 等级 |
| 环境身份 | 环境名、区域/集群、主机或容器标识、应用 commit 和镜像 digest |
| 时间与执行主体 | UTC 时间、执行人/自动化身份、复核人；自动化任务也要记录运行 ID |
| 输入与工具 | 数据集摘要/随机种子、命令、工具版本、配置版本；不得放入秘密值 |
| 期望与观察 | 可量化验收条件、实际结果、错误定义和偏差说明 |
| 原始记录 | 受控存储位置、不可变 URL 或报告编号、SHA-256、生成时间 |
| 保存与访问 | 保存期限、到期处理、访问角色、是否含个人/敏感数据及脱敏方式 |
| 例外与复核 | 例外编号、补偿控制、风险接受人、到期日和下次复核日期 |

高风险或阻塞发布的控制项，执行人与独立复核人应分离；若团队规模导致无法分离，须记录补偿复核方式和批准人。

证据必须保持“原始记录 → 摘要 → 发布决策”的可追溯链路；发布后不得只修改摘要而不保留原始
记录。涉及日志、素材、provider 响应或备份的证据，应先脱敏，再在受控存储中保存。证据包不能
包含 API key、数据库密码、访问令牌或未脱敏的用户内容。

建议证据包采用以下目录和清单结构；目录名可按组织系统调整，但不得丢失对应关系：

| 路径/对象 | 内容 | 最低要求 |
| --- | --- | --- |
| `manifest.json` | 证据 ID、发布 SHA、环境、生成时间、保管期限、对象版本和文件 SHA-256 | 机器可读、不可变保存 |
| `control-register.csv` | 固定版本的框架条款、适用性、测试结果、证据 ID、责任人与例外 | 与发布决策总表和 EV 索引互相引用；不得只写“符合标准” |
| `raw/` | CI 日志、扫描原始 JSON、镜像 inspect、迁移/备份/压测原始输出 | 保留原始格式，不只保留截图 |
| `derived/` | 脱敏摘要、指标、RPO/RTO、风险汇总和本模板填写结果 | 每项指向 `raw/` 对象 |
| `review/` | 复核意见、例外审批、签署记录、变更单和 incident 关联 | 记录身份、时间和决定 |

`manifest.json` 至少应包含 `evidenceId`、`sourceRevision`、`environment`、`generatedAt`、
`retentionUntil`、`classification`、`reviewer` 和每个对象的 `path`、`mediaType`、`sha256`、
`sourceRunId`。若证据含个人数据、用户素材或 provider 响应，清单必须标明分类、脱敏方式和访问角色。

建议 `manifest.json` 使用如下最小结构；示例中的值仅为占位符，不得原样作为真实发布证据：

```json
{
  "schemaVersion": "worldloom.deployment-evidence/v1",
  "evidencePackageId": "WL-REL-YYYY-NNN",
  "sourceRevision": "<40-char-git-sha>",
  "environment": { "name": "production", "region": "<region>", "cluster": "<cluster>" },
  "generatedAt": "YYYY-MM-DDThh:mm:ssZ",
  "retentionUntil": "YYYY-MM-DDT00:00:00Z",
  "classification": "internal",
  "reviewer": { "identity": "<account-or-ticket>", "reviewedAt": "YYYY-MM-DDThh:mm:ssZ" },
  "objects": [
    {
      "id": "EV-01-raw-001",
      "path": "raw/ci-run.json",
      "mediaType": "application/json",
      "sha256": "<64-hex>",
      "sourceRunId": "<immutable-run-id>",
      "containsPersonalData": false
    }
  ]
}
```

### 0.1 证据新鲜度、保管链与脱敏

证据等级不能替代证据新鲜度。每项证据必须同时满足“环境/版本匹配”和“仍在有效期内”；如果
发布期间发生配置、镜像、schema、拓扑、数据规模或 provider 合同变化，应重新执行受影响的控制，
不能沿用旧报告。

| 证据域 | 默认有效期/触发重测条件 | 最低复核要求 |
| --- | --- | --- |
| 源码、构建、镜像、SBOM、provenance | 仅对记录的 commit、镜像 digest 和构建 run 有效 | digest、签名主体、源码 revision、生成时间四者一致 |
| 漏洞扫描 | 必须针对本次部署 digest；扫描数据库时间不得晚于报告生成时间 | 记录 scanner、DB 版本/更新时间、策略和完整报告哈希 |
| Provider 合同与价格 | 每次正式发布重新确认；若采用模板默认周期，核对时间不超过 90 天；模型/价格/峰谷计费改变时立即重测 | 记录官方价格来源、核对时间、模型版本、币种/单位、峰谷/缓存假设及批准的账户预算 |
| 备份与恢复 | 最近一次备份满足目标 RPO；恢复演练默认不超过 90 天，或按组织政策执行 | 记录恢复目标、RPO/RTO、完整性检查和临时数据清理 |
| Worker/迁移/故障演练 | 最近一次拓扑、schema、运行时或重试策略变化后必须重测；否则默认不超过 90 天 | 记录故障注入时间线、任务最终状态、恢复次数预算、重复写入检查和复核人 |
| 目标规模压测 | 目标硬件、版本、数据集或容量模型变化后必须重测；否则默认不超过 90 天 | 记录生成器版本、数据摘要、随机种子、预热、持续时间和错误定义 |
| 告警、事件响应与隐私 | 关键联系人、告警路由、数据处理方或保留策略变化后必须重测；否则默认不超过 90 天 | 至少一次触发/撤销/升级记录，且不暴露秘密或未脱敏内容 |

上述 90 天是本模板的默认复核周期，不是所引框架规定的统一期限；应按组织风险政策调整，并在证据包记录依据。

证据保管链至少记录：生成者、上传者、复核者、时间、对象版本、SHA-256、访问角色、保留期限和
任何转存/脱敏动作。原始证据应写入受访问控制和不可变保留策略保护的存储；派生摘要或截图不能
覆盖、替代或删除原始记录。含用户素材、provider 响应、访问日志或个人数据的证据必须先脱敏，
并在清单中记录脱敏规则、执行者和复核结果。

### 0.2 发布放行规则

- `GO`：所有阻塞控制项为 `PASS`，关键项至少为 `E3`；供应链、漏洞、备份恢复、回滚和故障恢复均有原始记录与复核，不存在未到期的高危例外。
- `CONDITIONAL GO`：仅允许在明确列出剩余风险、补偿控制、风险接受人、到期日和回滚触发条件后使用；不能把 `PENDING`、`FAIL` 或缺失的生产证据改名为 `CONDITIONAL`。
- `NO-GO`：任一阻塞项为 `FAIL`，或关键生产事实为 `PENDING/E0`，或签名/摘要/漏洞报告无法关联，或例外已过期。`NO-GO` 发布不得继续扩大流量。
- 本模板记录的是证据和决定，不授予发布权限；最终决定必须由发布、技术、安全/隐私和运维职责人签署。

### 0.3 行业基线、适用性与映射

本模板是 WorldLoom 的发布证据清单，不是任何标准的完整实施、审计报告或认证。每次发布应固定所采用
基线的名称、版本/发布日期、适用范围和评估责任人；如客户合同、监管要求或组织政策更严格，应另附
适用性评估及差距/例外清单。不可仅凭本模板中有映射关系就声明符合某标准。

| 基线（固定版本） | 在本模板中的使用方式 | 对应章节 / 最低证据要求 |
| --- | --- | --- |
| NIST SSDF，SP 800-218 v1.1 | 以 PO / PS / PW / RV 实践组组织安全开发、软件保护、发布和漏洞响应证据；重点关注 `PS.3.2` 的发布来源/成分 provenance | `0`、`1.1`、`1.3`、`9`；记录源代码/构建/依赖/发布身份、扫描结果和漏洞处理闭环 |
| OWASP ASVS v5.0.0 | 用于应用及依赖其保护的环境技术控制验证；只登记本次部署实际适用的要求，不把此模板当作完整 ASVS 评估 | `3`、`4`、`9`；逐项记录固定版本的要求编号（格式 `v5.0.0-<编号>`）、适用性、测试方法、结果、证据和例外 |
| SLSA v1.2 Build Track | 用于构建 provenance、制品身份、签名验证和消费者校验；只声明实际达到且验证过的 Build Level | `1.1`、`1.4`；关联部署制品 digest、trusted builder、签名验证输出、source revision 与 workflow/run |
| NIST SP 800-61 Rev. 3 | 用于事件准备、检测、响应、恢复和复盘；将桌面推演或告警演练和实际生产事件明确区分 | `8`、`9`、`12`；记录演练场景、时间线、责任人、通知/升级、恢复结果、复盘事项和关闭证据 |
| Google SRE 发布与 canary 实践（指导性资料，非认证标准） | 用于按风险分阶段发布，以用户相关指标观察候选版本，并预先约定暂停/回滚决策 | `1.2`、`8`；提供基线/目标、候选与对照指标、样本/观察窗口、决策阈值及回滚记录 |

框架版本应在本次发布记录中固定，不能用“最新版”代替版本号。引用 ASVS 的要求时必须带版本前缀；
若标准版本升级或适用范围变化，应重新评估映射，而非静默替换旧证据。ASVS、SSDF 等技术基线不能
取代组织的法务/隐私判断、供应商合同、灾备义务或独立审计。

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
| 运行时基础镜像 / digest | `gcr.io/distroless/nodejs24-debian13@sha256:...`，按实际构建记录填写 |
| 构建基础镜像 / digest | `node:24-trixie-slim@sha256:...`，按实际构建记录填写 |
| Prisma migration 版本 | `待填写` |
| SBOM / 依赖审计报告 | `待填写，链接或报告哈希` |
| 漏洞数据库/扫描器版本 | `待填写，例如 Trivy 0.74.x；记录 DB 更新时间` |
| 目标环境 / 区域 / 集群 | `待填写` |
| 采用基线 / 版本 / 适用范围 | `待填写：标准/框架全名、固定版本或发布日期、本次适用章节/要求、排除项及批准人` |
| 部署定义 / IaC revision | `待填写：部署脚本、Compose/Kubernetes/Terraform 等的不可变 revision` |
| 运行时配置身份 | `待填写：脱敏配置快照哈希、配置版本、feature flag 状态；不得记录秘密值` |
| Secret manager 引用 | `待填写：秘密名称/版本 ID/轮换时间；不得记录秘密内容` |
| 发布窗口（UTC） | `待填写` |
| 执行人 | `待填写` |
| 复核人 | `待填写` |
| 变更单 / 工单 / incident 关联 | `待填写` |
| 回滚版本与触发条件 | `待填写` |
| 变更等级 / 审批记录 | `待填写：standard / normal / emergency；变更单、批准人和时间` |
| 发布策略 | `待填写：rolling / canary / blue-green；初始流量与放量条件` |
| 发布前检查 | `待填写：备份、迁移、配置、依赖、容量和回滚点` |
| 发布后观察窗口 | `待填写：持续时间、指标、阈值、值班人和结束条件` |
| 发布风险等级 / 影响面 | `待填写：变更影响、受影响功能/数据、最大流量/租户/实例暴露比例及风险批准人` |

发布身份必须能从 Git commit、镜像 digest、迁移版本和部署记录互相对上；任一项无法关联时，
发布状态为 `NO-GO`。

### 1.1 供应链、构建来源与制品证明

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 源码身份 | 仓库 URL、完整 commit、发布 ref、工作树洁净状态和 lockfile 摘要已记录 | `待填写` | `PENDING / E0` | `EV-01` |
| 构建身份 | CI workflow、run ID、构建器身份、Node/pnpm/OS 版本和构建参数已记录 | `待填写` | `PENDING / E0` | `EV-01` |
| 制品摘要 | 部署的镜像以不可变 digest 标识，并与发布记录一致 | `待填写` | `PENDING / E0` | `EV-01` |
| 构建 provenance | CI 主分支构建通过 GitHub Artifact Attestations 生成签名 SLSA/in-toto provenance；subject 为本次构建导出的不可变镜像归档 | `主分支 CI 已自动生成；具体 run/artifact 待登记` | `CONDITIONAL / E1` | `EV-01` |
| provenance 校验 | evidence job 使用 `gh attestation verify` 校验签名、SLSA predicate、源码 revision 和 signer workflow；验证失败时阻断证据 job | `主分支 CI 已自动校验；具体输出待登记` | `CONDITIONAL / E1` | `EV-01` |
| SBOM | 生成 SPDX 或 CycloneDX SBOM，记录格式版本、生成器和文件摘要，并对同一制品生成签名 SBOM attestation | `CycloneDX 1.5；主分支 CI 已自动生成并校验签名声明` | `CONDITIONAL / E1` | `EV-01` |
| 漏洞门禁 | CI 对生产镜像执行 Trivy `os,library` 扫描；`CRITICAL,HIGH`（含未修复项）非零即阻断，报告作为 artifact 保存；任何例外必须单独审批，不得通过忽略配置隐藏 | `主分支 CI 已自动执行；具体报告待登记` | `CONDITIONAL / E1` | `EV-01` |
| 可复现性 | 独立重建摘要一致；若不一致，已记录差异、原因和风险接受 | `待填写` | `PENDING / E0` | `EV-01` |

“有 CI 运行”不等于“制品可信”。至少要能从部署镜像反查源码、构建运行、SBOM 和 provenance；
无法验证 subject digest、签名或漏洞例外时，`EV-01` 不得标记为 `PASS`。

### 1.2 部署执行与发布后验证

本节记录“证据已经具备”之后的实际发布动作，不能用 CI 通过代替。若使用 canary 或分批放量，
每个阶段都要记录流量比例、开始/结束时间、观测指标和继续/暂停/回滚决定。

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 发布前检查 | 变更单、备份、迁移计划、回滚点、告警静默范围和负责人均已确认 | `待填写` | `PENDING / E0` | `EV-11` |
| 发布执行 | 实际部署的 commit、镜像 digest、schema 版本与发布身份一致 | `待填写` | `PENDING / E0` | `EV-11` |
| 分批放量 | 每阶段满足错误率、延迟、队列、资源和业务 smoke 门槛后才放量 | `待填写` | `PENDING / E0` | `EV-11` |
| 用户相关 SLI/SLO 与基线 | 写明本次适用的可用性、成功率/正确性、延迟或任务完成 SLI、SLO 周期、当前基线和剩余 error budget；低流量时注明样本不足及替代验证方式 | `待填写` | `PENDING / E0` | `EV-11` |
| 阶段门槛与停止条件 | 对每个阶段填写错误率、P95/P99、队列/worker、DB/provider、资源、样本量和观察时长的数值门槛；注明比较基线、触发后暂停/回滚负责人及动作时限 | `待填写` | `PENDING / E0` | `EV-11` |
| 发布后 smoke | health、认证、核心读写、任务领取、检索/编译和关键 UI 链路通过 | `待填写` | `PENDING / E0` | `EV-11` |
| 稳定性观察 | 观察窗口内 5xx/429、P95/P99、DB pool、worker stale、provider 预算拒绝无未接受异常 | `待填写` | `PENDING / E0` | `EV-11` |
| 继续/暂停/回滚决定 | 决策人、时间、实际指标、阈值和理由已记录；回滚后再次执行 smoke | `待填写` | `PENDING / E0` | `EV-11` |
| 配置漂移检查 | 实际运行配置与批准的配置 revision/脱敏哈希一致；所有带外差异均有变更单与风险复核 | `待填写` | `PENDING / E0` | `EV-11` |
| 变更收尾 | 关闭临时权限/静默/测试数据，更新版本、工单、证据索引和复盘事项 | `待填写` | `PENDING / E0` | `EV-11` |

### 1.3 漏洞扫描与例外管理

| 字段 | 发布记录 |
| --- | --- |
| 扫描器与版本 | `Trivy / 待填写版本` |
| 扫描对象 | `生产镜像 digest；不得只扫描源码目录或 mutable tag` |
| 包类型 | `os,library` |
| 阈值 | `CRITICAL,HIGH；fixed 与 unfixed 均计入` |
| 扫描数据库 | `数据库版本/更新时间/下载来源待填写` |
| 扫描报告 | `不可变 artifact/对象版本 + SHA-256 待填写` |
| 结果汇总 | `CRITICAL: 待填写；HIGH: 待填写；UNKNOWN/LOW/MEDIUM: 待填写` |
| 例外状态 | `无 / 例外编号待填写；例外不写入默认忽略文件` |
| 例外批准 | `安全负责人、风险接受人、补偿控制、到期日待填写` |
| 复扫计划 | `修复版本、负责人、截止时间和关闭证据待填写` |

漏洞例外必须逐项记录漏洞 ID、受影响包/版本、是否可达、影响评估、修复可用性、补偿控制和到期日。
没有风险接受与期限的例外不得进入 `CONDITIONAL GO`；已过期或与部署镜像 digest 不匹配时必须 `NO-GO`。

### 1.4 供应链证据最低闭环

发布包必须能按以下链路回溯：

`源码 commit → CI run → 构建基础镜像 digest → 生产镜像 digest → SBOM → 漏洞报告 → 签名 provenance/SBOM → 部署记录`

每一步至少保存 subject/digest、生成时间、工具版本和下游引用。对于 GitHub Artifact Attestations，
应同时保存验证命令和机器可读输出；仅保存 UI 绿色状态或截图不能证明 subject、签名者和源码 ref 一致。

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
| 部署执行与发布后验证 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-11` | 是 |

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

`maxEstimatedCostUsdPerRun` 是基于 provider 已返回 usage 的应用侧停止阈值，不是账单硬上限；当前在途请求
可能令实际费用超过阈值。若需要硬性支出限额，必须另附 provider 账户/项目限额或等效外部控制的实测证据。

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
| 迁移兼容矩阵 | 记录旧/新应用版本与迁移前/后 schema 的兼容组合；滚动期间需要回滚时旧应用仍能安全运行，或已审批维护窗口 | `待填写` | `PENDING / E0` | `EV-05` |
| 迁移影响评估 | 记录受影响表/行数级别、锁与阻塞风险、预计时长、磁盘/连接需求、超时和停止条件；在生产同构数据副本验证高风险迁移 | `待填写` | `PENDING / E0` | `EV-05` |
| 破坏性变更策略 | 优先采用 expand → migrate/backfill → contract 分阶段变更；删除/改名/类型收窄等不可逆步骤需独立阶段、备份/恢复点、数据影响与风险批准 | `待填写` | `PENDING / E0` | `EV-05` |
| 应用回滚 | 回滚镜像/版本后 health、读写和任务状态正常 | `待填写` | `PENDING / E0` | `EV-05` |
| 数据库回退/前向修复决策 | 明确该迁移能否 down；若不能安全 down，写明 forward-fix 或从备份/PITR 恢复方案、可接受数据损失和决策人 | `待填写` | `PENDING / E0` | `EV-05` |
| 迁移后校验 | 记录 migration ID、开始/结束时间、结果、关键约束/索引/行数核对及代表性业务读写 smoke | `待填写` | `PENDING / E0` | `EV-05` |
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
| stale recovery budget / provider backoff | `待填写：WorldLoom 默认最多 3 次 stale recovery；provider 重试策略按实际 runner/provider 配置记录` |
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
| 单元/集成测试 | 111/111 通过 | `E1` | `pnpm test` |
| 类型、格式、lint、构建 | 通过 | `E1` | `pnpm typecheck`、`pnpm format:check`、`pnpm lint:strict`、`pnpm build` |
| 严格部署 preflight | 7 pass、15 failure；provider 凭据/价格快照配置通过，但运行预算和生产发布事实仍阻断发布 | `E1` | `pnpm deployment:preflight -- --strict` |
| Provider 价格证据新鲜度 | 90 天内 HTTPS 来源元数据、核对日、模型版本和计费基准格式通过；测试会拒绝过期/未来日期及无效 URL，但不联网核对价格内容 | `E1` | `pnpm exec vitest run tests/deployment-pricing-evidence.test.ts` |
| 严格部署 preflight（显式运行时预算覆盖） | 8 pass、14 failure；配置化 CompileRun per-run token/estimated-cost soft guard 通过，但不代表其他 LLM 调用受累计预算保护、provider 账户硬支出上限或生产部署通过 | `E1` | `WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN=120000 WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN=24000 WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN=1.5 pnpm deployment:preflight -- --strict` |
| API 可用性审计 | 50/50 通过 | `E2` | `pnpm run audit http://localhost:4310` |
| UI 验收 | 41/41，FAIL 0，WARN 0 | `E2` | `node scripts/ui-shots.mjs ...`、`node scripts/ui-acceptance.mjs ...` |
| 本地备份恢复 | 26 表、5 世界，临时数据清理 | `E2` | `pnpm db:backup:drill` |
| 本地 embedding 容器验收 | remote 未配置时，容器使用 `Xenova/bge-m3` 索引 8 条，检索模式为 `hybrid` 并命中 8 条 | `E2` | `pnpm embeddings:download`；Full Compose；`POST /api/worlds/:id/semantic-index` + `/search` |
| 检索基准 | 500 entities、2000 events，12 samples，P95 192.5ms，RSS 增量 23.4 MiB；本机门槛通过 | `E2` | `pnpm benchmark:retrieval http://127.0.0.1:4310` |
| 依赖 SBOM | CycloneDX 1.5 生产依赖清单，包含 lockfile SHA-256 与源码 revision；CI artifact 需按发布记录归档 | `E1` | `pnpm run sbom -- --output artifacts/worldloom-sbom.cdx.json` |
| 生产运行时镜像安全扫描（本地复测） | distroless Node 24 Debian 13，Trivy `os,library` 严格扫描 `CRITICAL,HIGH` 为 0；仅证明该构建与扫描时点 | `E1/E2` | `docker build ...`；Trivy JSON 报告与 SHA-256 归档 |
| CI 证据关联索引 | 同一 commit 的 SBOM、不可变镜像 inspect、Trivy 漏洞结果、签名 provenance 和签名 SBOM attestation 校验结果已关联并生成 `EV-01` machine-readable index；注册表 digest、漏洞例外和独立复核仍需补充 | `E1 / CONDITIONAL` | GitHub Actions `evidence` job artifact；`node scripts/verify-build-evidence.mjs ... --vulnerability-report ... --provenance ... --sbom-provenance ...` |
| Compose 安全绑定 | DB 仅绑定 `127.0.0.1:43133` | `E1/E2` | `docker compose config --quiet`、`docker compose ps` |
| Full Compose 拓扑 | `db → migrate → app + worker`；worker 无宿主端口且固定 `WORLDLOOM_WORKER=true` | `E2` | `docker compose --profile full up -d --build`、`docker compose --profile full ps` |
| 独立 Worker runtime smoke | 独立 worker 领取 queued `SemanticIndexJob`，1 次尝试完成并持久化 1 个向量；临时世界已清理 | `E2` | full Compose + 本地模型；`pnpm worker:smoke` |
| 独立 Worker stale recovery | 独立 worker 重新领取过期 heartbeat 的 `running` 任务，`attempts` 至少增加 1、`recoveryAttempts` 增加 1，完成并持久化 1 个向量；临时世界已清理 | `E2` | full Compose + 本地模型；`pnpm worker:recovery-smoke` |
| 独立 Worker kill/restart recovery | 实际 `SIGKILL` worker 后 startedAt 改变，lease 过期后 `attempts 1→2`、`recoveryAttempts=1`，64/64 索引完成且向量 64 条无重复；临时世界已清理 | `E2` | full Compose + 本地模型；`pnpm run worker:chaos-smoke -- --timeout-ms=180000 --entities=64`；2026-09-23 UTC 脱敏输出已留存 |
| CI / 容器 / E2E | 以对应 commit 的 GitHub Actions 为准；漏洞门禁失败时必须登记失败报告和修复后的复跑 run，不得只保留成功截图 | `E1/E2` | `gh run view <run-id>` |

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
| EV-11 | 部署执行与发布后验证 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |

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

- [NIST SP 800-218 Secure Software Development Framework v1.1](https://csrc.nist.gov/pubs/sp/800/218/final)：安全开发、供应链和发布流程的风险驱动基线；NIST 明确该框架应用时应结合组织风险、适用性和资源定制，而不是机械照单执行。
- [OWASP Application Security Verification Standard 5.0.0](https://owasp.org/projects/asvs)：Web 应用及其依赖环境技术控制的可验证要求；引用控制项时固定版本，使用 `v5.0.0-<requirement-id>` 格式。
- [Google SRE Data Integrity](https://sre.google/sre-book/data-integrity/)：区分备份与可恢复性，要求以实际恢复能力、数据完整性和可接受的数据丢失量驱动设计。
- [Google Cloud Disaster Recovery Scenarios for Data](https://docs.cloud.google.com/architecture/dr-scenarios-for-data)：RPO/RTO、恢复目标与数据库备份/日志链路的记录方式参考。
- [Google SRE Canarying Releases](https://sre.google/workbook/canarying-releases/) 与 [Production Services Best Practices](https://sre.google/sre-book/service-best-practices/)：分阶段发布、用户相关 SLI/SLO、监控和回滚决策的指导性实践，非认证标准。
- [SLSA v1.2 specification](https://slsa.dev/spec/v1.2/)、[Build requirements](https://slsa.dev/spec/v1.2/build-requirements)、[Distributing provenance](https://slsa.dev/spec/v1.2/distributing-provenance) 与 [Verifying artifacts](https://slsa.dev/spec/v1.2/verifying-artifacts)：构建 provenance、制品摘要和验证链路参考；实际声明的 Build Level 必须按该版本要求核实；若实现使用其他 predicate/attestation 版本，应在证据中固定格式版本和验证方式。
- [GitHub Artifact Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) 与 [`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify)：签名制品证明、subject 绑定和验证输出参考。
- [Trivy image scanning](https://github.com/aquasecurity/trivy) 与 [Trivy Action](https://github.com/aquasecurity/trivy-action)：容器 OS/语言包漏洞扫描、阈值和 CI 集成参考。
- [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)：事件准备、检测、响应、恢复和复盘参考。
- [OpenTelemetry Logging Specification](https://opentelemetry.io/docs/specs/otel/logs/)：日志与 trace/span/request context 的关联参考。

项目自身的安全边界和门禁仍以 [DEPLOYMENT_SECURITY.md](./DEPLOYMENT_SECURITY.md)、
[ACCEPTANCE.md](./ACCEPTANCE.md) 和 [ISSUES.md](./ISSUES.md) 为准。
