# WorldLoom 部署证据包模板

本文件用于记录一次具体发布的可审计证据。它不是安全自证、合规认证或生产备份本身；每个
`PASS` 都必须能由部署方提供可复核的原始记录、命令输出、监控截图/导出、工单或报告链接。
没有证据时必须写 `PENDING`，不得仅因为环境变量被设置为 `true` 就判定通过。

**模板版本：** `1.7`　**适用范围：** WorldLoom 单次发布/变更　**默认时区：** UTC<br>
**证据保管人：** `待填写`　**批准记录：** `待填写`　**最近修订：** `2026-09-24`

**本版修订：** 补充部署范围/信任边界、控制责任和例外登记；明确 E0–E4 是 WorldLoom 内部证据分级而非
行业认证等级；加强身份生命周期、API 滥用防护、漏洞披露/修复时限、provider 数据处理和加密/密钥轮换证据，
并增加 NIST CSF 2.0 风险治理映射；本版再加入 ISO/IEC 27001/27002、ISO/IEC 27701、ISO/IEC 42001 和 AICPA SOC 2 Trust Services Criteria 的条件性映射，并要求区分控制设计与持续运行有效性、记录抽样期间和总体范围；更新 NIST Privacy Framework 1.1 的草案状态说明。此修订不代表项目已满足这些基线或取得任何认证/审计报告。

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
| NIST CSF 2.0 | 以组织风险治理和六项核心功能作高层结果映射；用于明确本次发布的责任、风险接受、保护/检测/响应/恢复能力，不作为逐条技术控制清单 | `0.2`、`0.4`、`1`、`5`、`8`、`9`、`12`；记录系统边界、责任、风险容忍、例外和恢复证据 |
| ISO/IEC 27001:2022 与 ISO/IEC 27002:2022（组织选择采用时） | 以 27001 要求组织建立并持续改进 ISMS、风险评估/处置及适用性声明（SoA）；按风险选择 27002 控制指导，不要求机械采用全部控制 | `0.3`、`0.4`、`1`、`3`、`5`、`8`、`9`；固定 ISMS 范围、风险处置、SoA、控制责任人、实施/运行证据与例外。只有组织范围内的独立认证结果才能支持 ISO/IEC 27001 认证声明 |
| NIST Privacy Framework 1.0 | 以自愿、风险驱动的隐私框架补充网络安全控制；记录数据处理目的、数据流、第三方处理、个人影响和隐私风险处置，不作为法律合规结论 | `0.4`、`4`、`8`、`9`；记录所选 Core/Profile、适用性、数据主体影响、保留/删除与跨境处理决定。法域法律义务另行评估 |
| ISO/IEC 27701:2025（处理个人可识别信息/个人数据时） | 以隐私信息管理体系（PIMS）要求补充控制者/处理者职责、处理活动和隐私风险治理；结合具体角色与适用法域选取条款 | `0.3`、`0.4`、`4`、`8`、`9`；记录控制者/处理者角色、数据处理清单、目的与适用依据评估、数据主体请求、第三方/跨境处理、保留删除和事件处置证据。模板映射不构成法律意见或认证 |
| AICPA SOC 2 Trust Services Criteria（2017 TSC，Points of Focus 修订版 2022；服务组织客户/合同要求时） | 按系统边界选择 Security 及适用的 Availability、Processing Integrity、Confidentiality、Privacy 类别；该 TSC 是控制评价准则，不是产品认证或安全扫描清单 | `0.3`、`0.4`、`1`、`3`、`5`、`8`、`9`；记录系统描述、承诺/服务目标、控制频率、控制总体与抽样期、例外、补偿性用户实体控制（CUEC）及次服务组织责任。SOC 2 报告须由具备资质的独立 CPA 按适用鉴证准则出具 |
| OWASP ASVS v5.0.0 | 用于应用及依赖其保护的环境技术控制验证；只登记本次部署实际适用的要求，不把此模板当作完整 ASVS 评估 | `1.1`、`3`、`4`、`9`；逐项记录固定版本的要求编号（格式 `v5.0.0-<编号>`）、适用性、测试方法、结果、证据和例外 |
| OWASP API Security Top 10 2023 | 用作 API 风险分类与测试覆盖参考，不是认证或完整安全验证标准 | `3`、`4.1`、`4.3`；重点提供对象/属性/功能级授权、资源消耗、SSRF、API inventory 与第三方 API 响应校验的负向测试证据 |
| CIS Docker Benchmark 1.8.0（仅 Docker Engine 部署） | 作为容器宿主机/daemon/运行时安全配置基线；只声明已逐项核对的适用建议，不把自动扫描分数视为完整安全证明 | `1.1`、`3.2`、`6`；固定 benchmark 版本、Docker Engine/Compose 版本、适用 recommendation ID、N/A 理由、扫描原始结果和批准例外。非 Docker 运行时须记录等效基线 |
| CIS Kubernetes Benchmark / Kubernetes Pod Security Standards（仅 Kubernetes 部署） | 按实际 Kubernetes 版本固定 CIS Benchmark 版本和适用层（控制平面/节点/工作负载）；以 Pod Security Standards 和平台强制策略补充工作负载边界，不把托管控制平面的责任误记为应用方已验证 | `1.2`、`3.3`、`6`；记录集群/发行版版本、Benchmark recommendation ID、Pod Security Admission 模式、策略拒绝测试、控制方/供应商责任和原始配置证据 |
| OWASP Top 10 for LLM Applications 2025 | 用作 WorldLoom LLM/RAG/MCP 功能的风险识别提示，不是完整安全标准；按实际启用的模型、检索和工具能力选择风险项并记录验证 | `4.3`、`8`、`9`；重点核验 prompt injection、敏感信息泄露、不安全输出处理、供应链和过度代理权限 |
| NIST AI 600-1，Generative AI Profile | 用于将生成式 AI 风险纳入生命周期治理、映射、测量和管理；作为自愿风险框架，不作为模型准确性/合规认证 | `0.4`、`4`、`8`、`9`；记录预期用途、风险容忍、评测数据/方法、人工监督和已知限制 |
| ISO/IEC 42001:2023（AI 系统提供方/部署组织按需采用） | 以 AI 管理体系（AIMS）要求补充组织治理、风险评估、影响评估、运行监测和持续改进；与 NIST AI RMF 可并用但不可互相替代 | `0.3`、`0.4`、`1.1`、`4.3`、`8`、`9`；记录 AI 系统边界、预期用途、责任、风险/影响评估、数据与模型来源、人工监督、变更和事件处理。不得由单次模型测试推断 AIMS 符合或认证 |
| SLSA v1.2 | 用于构建 provenance、制品身份、签名验证和消费者校验；只声明实际达到且验证过的 Build Track Level，不将生成 attestation 等同于消费者已验证 | `1.1`、`1.2`、`1.4`；关联部署制品 digest、trusted builder、签名/来源验证输出、source revision 与 workflow/run |
| NIST SP 800-61 Rev. 3 | 用于事件准备、检测、响应、恢复和复盘；将桌面推演或告警演练和实际生产事件明确区分 | `8`、`9`、`12`；记录演练场景、时间线、责任人、通知/升级、恢复结果、复盘事项和关闭证据 |
| Google SRE 发布与 canary 实践（指导性资料，非认证标准） | 用于按风险分阶段发布，以用户相关指标观察候选版本，并预先约定暂停/回滚决策 | `1.2`、`8`；提供基线/目标、候选与对照指标、样本/观察窗口、决策阈值及回滚记录 |

框架版本应在本次发布记录中固定，不能用“最新版”代替版本号。引用 ASVS 的要求时必须带版本前缀；
若标准版本升级或适用范围变化，应重新评估映射，而非静默替换旧证据。ASVS、SSDF 等技术基线不能
取代组织的法务/隐私判断、供应商合同、灾备义务或独立审计。

版本注意：本模板将 NIST Privacy Framework 1.0 固定为已发布基线；截至本模板修订日 `2026-09-24`，NIST 官方资源仍将 1.1 标为初始公开草案/更新项目，只有正式版本发布并完成差异评估后，才可在新证据包中采用 1.1，不得把草案当作已发布版本。ISO/IEC 27701:2025 已取代 2019 版；新证据包不得静默沿用旧版条款号。CIS Docker Benchmark 仅适用于相应 Docker Engine 主机和运行时配置；Kubernetes 部署应按集群版本核对 CIS Kubernetes Benchmark 与官方 Pod Security Standards；托管容器平台应引用其实际平台基线及共享责任边界。

### 0.4 发布范围、控制责任与例外

每次发布必须先定义被评估的部署形态和系统边界；“已通过”仅对记录的形态、环境、版本和数据流有效。
WorldLoom 当前是本地/受控主机应用，不自带多租户认证授权。若由部署方暴露到互联网或承载多个组织，
必须按实际架构补齐网关/应用授权和租户隔离证据，不能把单租户演练外推为多租户安全证明。

| 范围/治理字段 | 本次发布记录 |
| --- | --- |
| 部署形态 | `待填写：本地 / 受控单租户 / 托管单租户 / 多租户公网；选择后说明外部暴露面` |
| 系统边界与信任边界 | `待填写：DNS/CDN/WAF/网关、Web、worker、数据库、对象/备份存储、provider；附网络/数据流图版本或摘要` |
| 资产与数据分类 | `待填写：凭据、用户素材、世界数据、日志/遥测、备份；分类及影响等级` |
| 外部处理方 | `待填写：LLM/embedding/云/监控供应方、服务区域、传输数据类别及合同/隐私评估引用` |
| 控制适用性基线 | `待填写：框架固定版本、目标等级/深度、适用要求、排除项和批准人` |
| 风险评估方法 | `待填写：组织风险方法/版本、影响与可能性刻度、风险容忍及剩余风险接受权限；不得临时发明分数后声称符合框架` |
| 威胁模型 | `待填写：模型/数据流图或文档 revision、关键资产/信任边界、滥用场景、评估人和复核日期` |
| 控制执行责任人 | `待填写：每个阻塞控制指定一名 accountable owner 和执行人` |
| 独立复核/发布批准 | `待填写：复核人、发布负责人、风险接受权限及其批准记录` |
| 本次例外总表 | `待填写：引用例外编号；无例外则明确“无”` |

每个控制登记项还应包含：控制目标/标准条款、适用性理由、验证方法（自动/人工/演练）、客观验收条件、
结果、证据 ID、责任人、独立复核人、复核日期和下次到期日。`N/A`、未完成项和例外不得隐藏在摘要中；
例外至少记录风险描述/等级、影响面、补偿控制、风险接受人、批准时间、到期时间、剩余事项负责人及关闭证据。
小团队无法职责分离时，记录补偿复核（例如第二次独立检查、外部复核或不可变审计记录）和批准人。

### 0.5 控制设计与运行有效性证据

对选用的基线、客户控制问卷或审计计划，逐项说明验证的是控制“设计/实施”还是“运行有效性”。配置截图、策略文件、一次 CI 通过通常只能证明特定时点的设计或实施，不能单独证明控制在整个审计/观察期间持续执行。若只做单次发布验收，记录该次验证窗口；若客户要求期间型鉴证（例如 SOC 2 Type 2），应按鉴证计划覆盖完整期间，并由独立鉴证方确定取样方法。

控制登记表及原始证据至少补充以下字段（不适用时写明理由）：

| 字段 | 最低记录要求 |
| --- | --- |
| 控制目标与责任 | 固定基线版本/条款、控制目标、适用性理由、控制所有者、执行者和复核者 |
| 控制类型与频率 | 预防/检测/纠正及自动/人工；事件触发或执行频率；依赖的系统、人员和第三方 |
| 设计/实施测试 | 设计是否足以处理风险；配置/策略是否已部署；测试步骤、预期结果、观察结果及负向验证 |
| 运行期间 | 被评价环境、总体期间起止（UTC）、发布/配置变更；单次验收不得伪装为期间型证据 |
| 总体与抽样 | 被控制总体的定义、期间总数、查询/导出来源、筛选条件、抽样方法/数量和选择理由；保存可复核的脱敏底稿 |
| 例外与补救 | 每个偏差的影响、发现时间、根因、风险接受/补偿控制、负责人、期限、关闭复测和独立复核 |

报告状态要明确写作 `设计 PASS / 运行 PENDING` 等，不得将设计检查的通过外推为持续运行有效。SOC 2 Type 1 与 Type 2 的鉴证范围和期间不同；本模板只辅助整理证据，不能决定报告类型、重要性、取样充分性或鉴证意见。

## 证据与状态规范

### 证据等级

以下 `E0`–`E4` 是 WorldLoom 为区分证据来源而定义的内部标记，不是 NIST、OWASP、SLSA 或审计机构的
通用等级，也不能替代任何框架自身的成熟度/保证等级。每次引用都须另行记录实际采用的框架条款与评估方法。

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
| 应用与迁移基础镜像 / digest | `mcr.microsoft.com/dotnet/runtime-deps:10.0-noble-chiseled@sha256:...`，按实际构建记录填写 |
| 构建基础镜像 / digest | `node:24-trixie-slim@sha256:...`，按实际构建记录填写 |
| Prisma migration 版本 | `待填写` |
| SBOM / 依赖审计报告 | `待填写，链接或报告哈希` |
| 漏洞数据库/扫描器版本 | `待填写，例如 Trivy 0.74.x；记录 DB 更新时间` |
| 目标环境 / 区域 / 集群 | `待填写` |
| 部署形态 / 暴露面 | `待填写：本地、受控单租户、托管单租户或多租户公网；外部入口及网络/数据流图 revision` |
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
| 代码与部署配置安全测试 | 按适用性执行 SAST、秘密检测、依赖/SCA、IaC/容器配置检查及针对暴露面的 DAST；固定规则集/阈值、扫描范围、工具/数据库版本、误报处置和例外，并保存机器可读报告。不能把镜像漏洞扫描或通用 DAST 单独当作完整应用安全验证 | `待填写：工具、范围、规则版本、结果和批准例外` | `PENDING / E0` | `EV-01`、`EV-03` |
| 可复现性 | 独立重建摘要一致；若不一致，已记录差异、原因和风险接受 | `待填写` | `PENDING / E0` | `EV-01` |
| 来源仓库保护 | 受保护发布分支、审查/批准规则、身份归属和 tag/release 权限已核验；紧急绕过均有记录 | `待填写` | `PENDING / E0` | `EV-01` |
| 构建工作流权限 | Actions 权限遵循最小权限；第三方 actions 固定到不可变 SHA；部署凭据使用短期身份/受限环境审批，或记录无法采用时的补偿控制 | `待填写` | `PENDING / E0` | `EV-01` |

“有 CI 运行”不等于“制品可信”。至少要能从部署镜像反查源码、构建运行、SBOM 和 provenance；
无法验证 subject digest、签名或漏洞例外时，`EV-01` 不得标记为 `PASS`。

### 1.2 部署执行与发布后验证

本节记录“证据已经具备”之后的实际发布动作，不能用 CI 通过代替。若使用 canary 或分批放量，
每个阶段都要记录流量比例、开始/结束时间、观测指标和继续/暂停/回滚决定。

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 发布前检查 | 变更单、备份、迁移计划、回滚点、告警静默范围和负责人均已确认 | `待填写` | `PENDING / E0` | `EV-11` |
| 部署前制品验证 | 对将部署的确切 OCI digest 验证签名/attestation 与 provenance；按发布策略校验可信仓库、源码 revision/ref、构建 workflow/builder 身份和 subject digest。验证失败必须阻止部署；若平台不支持 admission enforcement，保存部署流水线验证结果并记录补偿控制。没有上游签名/provenance 时，显式记录来源、验证方法和风险接受，不得写成已验签 | `待填写：策略版本/摘要、验证命令及原始输出、负向拒绝测试或批准的例外` | `PENDING / E0` | `EV-01`、`EV-11` |
| 发布执行 | 实际部署的 commit、镜像 digest、schema 版本与发布身份一致 | `待填写` | `PENDING / E0` | `EV-11` |
| 分批放量 | 每阶段满足错误率、延迟、队列、资源和业务 smoke 门槛后才放量 | `待填写` | `PENDING / E0` | `EV-11` |
| 用户相关 SLI/SLO 与基线 | 写明本次适用的可用性、成功率/正确性、延迟或任务完成 SLI、SLO 周期、当前基线和剩余 error budget；低流量时注明样本不足及替代验证方式 | `待填写` | `PENDING / E0` | `EV-11` |
| 阶段门槛与停止条件 | 对每个阶段填写错误率、P95/P99、队列/worker、DB/provider、资源、样本量和观察时长的数值门槛；注明比较基线、触发后暂停/回滚负责人及动作时限 | `待填写` | `PENDING / E0` | `EV-11` |
| 发布后 smoke | health、认证、核心读写、任务领取、检索/编译和关键 UI 链路通过 | `待填写` | `PENDING / E0` | `EV-11` |
| 启动/存活/就绪探测 | 分别记录 startup、liveness、readiness（或平台等效项）的语义、阈值、初始延迟与失败动作；探测不得泄漏敏感依赖信息。演练启动慢、依赖暂时不可用和恢复场景，确认不发生重启风暴或把未就绪实例接入流量 | `待填写` | `PENDING / E0` | `EV-11` |
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
| 已部署制品持续监测 | `待填写：镜像/依赖何时重扫，漏洞数据库来源/更新时间，触发紧急复扫的条件` |
| 修复时限 | `待填写：按组织漏洞分级定义修复/缓解 SLA、升级路径和超时批准；不得将模板建议冒充标准强制期限` |
| 漏洞披露接收路径 | `待填写：公开安全联系入口、受理负责人、确认/分流/披露流程；如 N/A，记录原因` |

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
| provider、embedding 与 LLM/RAG/MCP 安全 | `PENDING` | `E0` | `待填写` | `待填写` | `EV-04` | 是 |
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
| 身份认证 | 受保护入口使用 OIDC/SAML 或等价身份系统；若仅单租户受控部署采用 Basic Auth，须限定网络、强凭据/轮换并单独接受风险 | `待填写` | `PENDING / E0` | `EV-02` |
| 管理员与高权限身份 | 管理员启用 MFA/等价强认证；服务账号独立、最小权限、可轮换且不允许交互登录（如适用） | `待填写` | `PENDING / E0` | `EV-02` |
| 访问授权与生命周期 | 角色/权限边界、最小权限、账号开通/变更/离职撤销和定期访问复核均有记录；紧急账号有监控与回顾 | `待填写` | `PENDING / E0` | `EV-02` |
| 未认证请求 | 访问受保护页面/API 得到预期 401/403，不泄露数据 | `待填写` | `PENDING / E0` | `EV-02` |
| 对象级授权 / 租户边界 | 验证跨用户/组织对象 ID 替换、导出、删除及后台任务访问；若单租户，记录唯一信任主体和边界；多租户必须有应用级隔离测试 | `待填写` | `PENDING / E0` | `EV-02` |
| TLS | 外部入口 HTTPS，证书链、有效期和自动续期已验证 | `待填写` | `PENDING / E0` | `EV-03` |
| HSTS | 仅在可信 TLS 终止后启用，且 max-age/子域策略已审核 | `待填写` | `PENDING / E0` | `EV-03` |
| 转发头 | 代理清理并重写 `X-Forwarded-*`；应用只信任可信代理 | `待填写` | `PENDING / E0` | `EV-03` |
| 响应头 | `nosniff`、`DENY`、`no-referrer`、Permissions-Policy 和实际 CSP 已核验 | `待填写` | `PENDING / E0` | `EV-03` |
| 数据库网络 | PostgreSQL 端口不在公网安全组/公网监听中 | `待填写` | `PENDING / E0` | `EV-02` |
| CORS / CSRF / Cookie | 精确允许源；认证 cookie 的 Secure/HttpOnly/SameSite 与跨站状态变更防护经验证；不需要 cookie 时记录替代机制 | `待填写` | `PENDING / E0` | `EV-02` |
| 请求限制与资源滥用 | 请求体/上传/解析深度/超时/并发均有上限；429、Retry-After、断路/排队策略及资源耗尽行为经测试 | `待填写` | `PENDING / E0` | `EV-02` |
| URL 摄入与出站请求 | 对 WorldLoom URL 导入验证协议、重定向、解析后的私网/保留地址及响应字节上限；按部署需要限制出站目标，记录 DNS/代理边界 | `待填写` | `PENDING / E0` | `EV-02` |
| 入口扫描 | 外部端口、证书和安全扫描结果无未接受的高危项 | `待填写` | `PENDING / E0` | `EV-03` |
| 应用安全验证 | 记录 ASVS 固定版本/目标等级、威胁模型范围、自动与人工测试覆盖；高风险暴露场景有针对性渗透/独立测试或书面风险接受 | `待填写` | `PENDING / E0` | `EV-03` |

安全测试报告必须绑定本次 commit/镜像 digest 和目标环境；记录测试身份/权限、覆盖的接口或资产、扫描器与规则版本、扫描时间、发现项及去重方式。漏洞/误报例外须有复核、风险接受人和到期日；报告首页、扫描百分比或“零发现”截图不能替代原始结果及覆盖范围。自动扫描不能替代对 WorldLoom 对象级授权、URL 摄入 SSRF、昂贵长任务/业务流滥用和 provider 降级边界的定向负向测试。

### 3.1 API 风险验证（OWASP API Security Top 10 2023）

按本次实际 API inventory 逐项评估适用性，并在控制登记表中引用相应 `APIx:2023` 风险类别、端点/方法、测试身份、
负向用例、期望拒绝结果和原始测试记录。不得只以通用 API 扫描器“无发现”代替授权与业务流测试。

| 风险验证 | 最低证据要求 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- |
| 认证（API2） | 验证登录/服务身份校验、令牌签名/受众/有效期、会话撤销、错误响应与暴力尝试限制；若认证由网关提供，需以端到端测试证明 API 无法绕过网关直接访问 | `PENDING / E0` | `EV-02` |
| 对象级授权（API1）与功能级授权（API5） | 对世界、实体、事件、来源、运行记录和导出等对象，覆盖读取/创建/修改/删除/搜索等适用操作；用不同主体替换对象 ID、调用管理/worker 路由，确认无越权读写 | `PENDING / E0` | `EV-02` |
| 对象属性授权（API3） | 对请求字段采用服务端 allowlist；测试额外字段、受保护字段、批量赋值及响应中过量属性，确认不能修改内部状态/权限且不泄露字段 | `PENDING / E0` | `EV-02` |
| 不受限资源消耗（API4）与敏感业务流滥用（API6） | 验证请求体/上传/分页/解析深度/超时/并发/长任务和付费 provider 调用的单操作上限、速率限制、取消/排队及 429 行为；记录批准的限值和实测结果 | `PENDING / E0` | `EV-02`、`EV-04` |
| SSRF（API7）与第三方 API 安全消费（API10） | 对 URL 导入、重定向、DNS 解析及私网/保留地址进行拒绝测试；provider 响应验证 TLS/目标、超时、字节上限、内容类型/schema 与错误处理；确认响应不进入未脱敏日志 | `PENDING / E0` | `EV-02`、`EV-04` |
| 安全配置（API8）与 API inventory（API9） | 将 OpenAPI/路由清单与实际部署端点核对；覆盖 CORS、错误响应、默认配置、调试/弃用路由和版本暴露；差异有负责人和关闭期限 | `PENDING / E0` | `EV-02`、`EV-03` |

若部署为单租户，应记录唯一信任主体、网络边界和未提供多租户隔离的事实；不得据此豁免公网认证、对象访问边界或
资源消耗控制。若相关 API 风险确实不适用，控制登记表必须给出架构依据、风险接受人和复核日期。

### 3.2 Docker 容器运行时硬化（CIS Docker Benchmark 1.8.0）

仅在直接管理 Docker Engine 的部署中使用本节。对每项适用建议记录 CIS recommendation ID、Docker Engine/Compose
版本、脱敏后的 `docker info`/`docker inspect`/Compose 配置、实测结果及原始证据哈希；不能仅记录扫描百分比。
托管容器平台应记录平台安全基线及对应证据，并说明 Docker 主机控制由谁负责。

| 检查项 | 期望结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- |
| Daemon 暴露面与权限 | Docker daemon API 不向不可信网络暴露；部署/管理权限最小化；应用容器不挂载 Docker socket | `PENDING / E0` | `EV-02` |
| 容器权限 | 应用/worker 以非 root 用户运行；不使用 privileged、host PID/network/IPC 或不必要的 Linux capabilities；例外逐项批准 | `PENDING / E0` | `EV-02`、`EV-07` |
| 系统调用与提权防护 | 保留适用的 seccomp 与 AppArmor/SELinux 等强制访问控制；启用 no-new-privileges（若运行时支持）；禁用未使用能力 | `PENDING / E0` | `EV-02` |
| 文件系统与挂载 | 能力允许时使用只读 root filesystem；可写目录限定到所需 volume/tmpfs，挂载只读优先，避免宽泛宿主机目录 | `PENDING / E0` | `EV-02`、`EV-09` |
| 资源与日志上限 | 为 CPU、内存、PID、日志轮转/磁盘占用设置可验证上限；结合 worker 并发、数据库连接和 provider 限额检查总容量 | `PENDING / E0` | `EV-07`、`EV-08`、`EV-09` |
| 网络隔离 | 仅代理对外提供入口；app、worker、数据库按职责分网；数据库不发布公网端口；出站访问按实际 provider/更新需求限制 | `PENDING / E0` | `EV-02` |
| Secrets 与镜像 | secrets 通过受控运行时机制注入且不写入镜像/环境导出；运行镜像按 digest 固定并关联 SBOM、provenance 和漏洞报告 | `PENDING / E0` | `EV-01`、`EV-10` |

若某项无法实施（例如只读文件系统与特定运行时行为不兼容），必须记录精确范围、原因、补偿控制、风险接受人和到期日；
不得以容器隔离替代主机补丁、宿主机访问控制或生产网络边界审查。

### 3.3 Kubernetes / 托管编排平台（按部署形态适用）

若目标环境使用 Kubernetes 或托管容器编排，不适用的 Docker Engine/daemon 控制应明确标记为 `N/A` 并说明平台责任边界，不能因此跳过工作负载、网络、身份或节点控制。按目标集群实际版本固定基线；至少记录 CIS Kubernetes Benchmark 适用项，以及是否强制执行 Kubernetes Pod Security Standards。以下要求是发布证据最低集，不替代完整 Benchmark 评估：

| 检查项 | 期望结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- |
| 平台基线与责任边界 | 记录 Kubernetes/发行版版本、CIS Benchmark 固定版本和 recommendation ID；区分云厂商负责的控制平面/节点控制与部署方责任，并验证 SLA/控制证据 | `PENDING / E0` | `EV-02` |
| Pod 安全策略 | 对应用命名空间采用 Pod Security Admission `restricted` 或经风险批准的等效策略；验证 privileged、host namespace、提权、未授权 capabilities/volume 等负向配置确实被 admission 拒绝 | `PENDING / E0` | `EV-02` |
| Workload 最小权限 | 非 root、只读 root filesystem（兼容时）、seccomp `RuntimeDefault`、drop `ALL` capabilities、禁止 privileged；CPU/内存/临时存储配置 requests/limits，PID 按节点 kubelet/runtime 能力设上限；例外逐项登记 | `PENDING / E0` | `EV-02`、`EV-08` |
| RBAC 与服务身份 | 每个 app/worker 使用独立 ServiceAccount 和最小 RBAC；无需 Kubernetes API 时禁用自动挂载 token；管理访问、紧急权限和定期复核有审计记录 | `PENDING / E0` | `EV-02` |
| 网络策略 | NetworkPolicy/平台等效策略限制 namespace 间、数据库、DNS 与外部 provider 出站；以允许/拒绝探针证明策略实际生效，不能仅提交 YAML | `PENDING / E0` | `EV-02` |
| Secret 与审计 | 凭据通过受控 secret manager/CSI 或加密存储注入；核验 etcd 静态加密（平台适用时）、读取权限、轮换/吊销和审计；不得在清单、GitOps 明文或 Pod 输出中泄露 | `PENDING / E0` | `EV-02`、`EV-10` |
| 镜像准入与运行身份 | 工作负载固定不可变 image digest；平台准入策略按组织策略验证可信来源/签名/provenance，并以不可信 digest 负向测试证明拒绝 | `PENDING / E0` | `EV-01`、`EV-02` |
| 探针、调度与终止 | startup/readiness/liveness 探针语义和阈值已验证；应用/worker 的 `terminationGracePeriodSeconds` 覆盖合理排空/检查点时间，滚动更新不会导致无就绪副本或任务重复副作用 | `PENDING / E0` | `EV-07`、`EV-11` |

证据应来自固定 revision 的 Helm/Kustomize/manifests、准入策略与网络策略，以及脱敏后的集群查询/审计输出；提交配置文件本身不证明策略已在目标集群启用。

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
| `maxEstimatedCostUsdPerRun` | `待填写：按每次业务操作批准的上限` |
| 超限行为 | `必须 fail-closed，不写入不完整正史` |
| usage 不完整行为 | `必须拒绝无法验证预算的任务` |
| 预算告警阈值与接收人 | `待填写` |
| 模型数据处理边界 | `待填写：发送给 provider 的输入类别/字段、区域、保留/训练用途、删除能力、DPA/合同引用及批准人；不得用“API”推断不训练或不保留` |
| provider 可用性/降级策略 | `待填写：超时/429/5xx、熔断/重试预算、降级能力及恢复后验证` |
| 运行时预算覆盖 | `WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN`、`WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN`、`WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN`（每次业务操作软阈值；记录批准来源，不代表并发全局/账户硬上限） |
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

### 4.3 生成式 AI、RAG 与 MCP 安全

此节仅在发布包含 LLM/RAG/MCP 能力时适用；不能以“模型输出看起来正常”代替边界测试。证据应使用无真实
敏感数据的对抗样例，记录模型/提示词/检索配置版本、测试集摘要、期望边界、观察结果和人工复核。

| 检查项 | 期望结果 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 直接/间接提示注入 | 对用户输入、URL/文件素材和检索片段中的恶意指令执行对抗测试；不允许不可信内容覆盖系统策略、泄露秘密或触发未授权副作用 | `待填写` | `PENDING / E0` | `EV-04` |
| RAG 数据边界 | 检索按授权主体/世界/数据范围过滤；跨世界或跨主体查询、引用和上下文拼接均有负向测试 | `待填写` | `PENDING / E0` | `EV-04` |
| 输出解析与副作用 | 模型输出进行 schema/长度/枚举/引用校验；无效或恶意输出安全拒绝；生成的治理变更保持待审阅，不能绕过人工合并/审批 | `待填写` | `PENDING / E0` | `EV-04` |
| 工具与 MCP 权限 | 记录暴露的工具、认证/网络边界、每工具副作用和速率限制；确认调用方不能通过 `worldId`/对象 ID 越权，长任务有预算、取消/失败和审计记录 | `待填写` | `PENDING / E0` | `EV-04` |
| AI 质量与安全回归 | 固定测试集/随机种子和评分规则，覆盖越权、无证据回答、引用正确性、提示注入、输出校验及 provider 降级；记录失败阈值和上线决策 | `待填写` | `PENDING / E0` | `EV-04` |
| 模型/嵌入资产来源 | 记录模型 ID/版本、下载来源、许可证、文件 SHA-256、缓存准备和升级回归；不把模型名称本身当作文件完整性证明 | `待填写` | `PENDING / E0` | `EV-04` |

若产品仅作为创作辅助，应清楚说明生成内容可能错误且需要用户审阅；若后续加入自主写入、外部动作或更高影响用途，
须重新评估工具权限、人类监督和风险接受，不得沿用只针对当前低副作用能力的证据。

## 5. 数据库、迁移、备份与恢复

| 字段 | 值 |
| --- | --- |
| PostgreSQL / pgvector 版本 | `待填写` |
| 生产数据库实例 / 区域 | `待填写` |
| 备份类型 | `待填写：full / incremental / PITR / WAL 等` |
| 备份频率与保留期 | `待填写` |
| 备份加密与密钥管理 | `待填写` |
| 备份存储隔离 | `待填写：独立账号/项目、跨卷或跨区域` |
| 备份不可变性与访问隔离 | `待填写：不可变/WORM 或等效防篡改策略、独立凭据、删除权限分离及恢复时的密钥可用性` |
| 数据库/存储加密 | `待填写：传输加密与静态加密范围、算法/服务配置标识、密钥所有者/轮换/吊销演练；不得登记密钥值` |
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
| 优雅停止与任务排空 | 收到 `SIGTERM`/平台停止信号后不再领取新任务；在 grace period 内完成或安全 checkpoint/release 当前任务，超时则允许 lease 机制恢复；验证无重复写入，且 grace period 与应用/provider 超时及 heartbeat/lease 配置相容 | `待填写：停止信号、grace period、任务状态变化及幂等性原始输出` | `PENDING / E0` | `EV-07` |

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
| 日志安全与保留 | 记录访问控制、保留/删除期限和审计；验证不记录密钥、认证令牌、完整用户素材或未脱敏 provider 响应 | `待填写` | `PENDING / E0` | `EV-09` |
| 告警演练 | 至少触发一次关键告警并确认接收人/升级路径 | `待填写` | `PENDING / E0` | `EV-09` |
| 事件分级与升级 | 已定义 Sev-1/2/3（或等价等级）、值班人、通知时限和升级路径，并完成一次演练 | `待填写` | `PENDING / E0` | `EV-09` |
| 检测/响应/恢复计时 | 演练记录 MTTD、MTTA、MTTR 或等价时间指标，并与目标比较 | `待填写` | `PENDING / E0` | `EV-09` |
| Runbook | 降级、回滚、恢复、密钥吊销和联系表已评审 | `待填写` | `PENDING / E0` | `EV-09` |
| 事件复盘 | 演练问题、根因、影响、责任人、截止日期和补救验证已登记 | `待填写` | `PENDING / E0` | `EV-09` |

## 9. 密钥、隐私与数据生命周期

| 检查项 | 实际结果 | 状态 / 等级 | 证据 |
| --- | --- | --- | --- |
| 密钥由 secret manager/运行时注入，不进入镜像、仓库、日志和导出 | `待填写` | `PENDING / E0` | `EV-10` |
| 加密与密钥生命周期 | `待填写：传输/静态加密适用范围、密钥所有权、轮换/吊销/恢复演练及访问审计；记录配置标识，不记录密钥内容` | `待填写` | `PENDING / E0` | `EV-10` |
| 生产 `.env`/临时文件权限与清理策略已验证 | `待填写` | `PENDING / E0` | `EV-10` |
| 用户素材、provider 响应和 QA 记录的保存范围已定义 | `待填写` | `PENDING / E0` | `EV-10` |
| 数据分类与处理依据 | 已标注数据分类、处理目的/依据、跨境或第三方处理边界和负责人 | `待填写` | `PENDING / E0` | `EV-10` |
| 第三方处理者清单 | 已登记 LLM/embedding/云/监控等处理者、服务区域、数据字段、保留/训练用途、合同/DPA 与退出/删除安排 | `待填写` | `PENDING / E0` | `EV-10` |
| 导出、删除、备份保留和恢复副本的生命周期已定义 | `待填写` | `PENDING / E0` | `EV-10` |
| 删除/撤销验证 | 已抽样验证删除、账号撤权、密钥轮换和备份到期处理的实际结果 | `待填写` | `PENDING / E0` | `EV-10` |
| 第三方依赖许可证与安全扫描已复核 | `待填写` | `PENDING / E1` | `EV-10` |
| 漏洞接收与披露责任 | 公开安全联系入口、内部响应负责人、确认/分流/修复/协调披露流程已验证；记录适用政策版本 | `待填写` | `PENDING / E0` | `EV-10` |
| 访问控制、审计日志和离职/撤权流程已验证 | `待填写` | `PENDING / E0` | `EV-10` |

## 10. WorldLoom 当前可复现的仓库/本地证据

以下记录只说明当前仓库和受控本地环境的状态，不得直接填入生产 `GO`：

| 证据 | 当前结果 | 等级 | 复现命令 |
| --- | --- | --- | --- |
| 单元/集成测试 | 2026-09-30 最新候选的隔离副本 39 文件、278/278 通过，新增演练保护、受控并发 CAS/恢复预算/executor 脱敏（先前 249/249、241/241、195/195）；2026-09-27 为 181/181，2026-09-24 为 137/137。最终发布应以对应 commit 的 CI 为准 | `E1 / Agent 本机观察，非独立 RepoSteward 验证` | 同一 Vitest runner 在隔离副本运行；产品入口 `pnpm test` |
| 类型、格式、lint、构建 | 通过 | `E1` | `pnpm typecheck`、`pnpm format:check`、`pnpm lint:strict`、`pnpm build` |
| 严格部署 preflight | 4 pass、1 warning、17 failure；strict 不再自动把 `.env.local` 当作运行时注入；本次实际进程缺 DeepSeek 凭据、数据库 URL、生产部署变量及发布证据，发布阻断 | `E1` | `pnpm deployment:preflight -- --strict` |
| Provider 价格证据新鲜度 | 90 天内 HTTPS 来源元数据、核对日、模型版本和计费基准格式通过；测试会拒绝过期/未来日期及无效 URL，但不联网核对价格内容 | `E1` | `pnpm exec vitest run tests/deployment-pricing-evidence.test.ts` |
| 健康探针隔离 | 独立 one-off 容器数据库可用时 live/ready 200，数据库不可达时 live 200/ready 503；2026-09-27 本机 4310 Compose app/worker 已换新镜像且均 `healthy`，live/ready 200，新镜像 API audit 53/53。生产编排平台仍需部署方验证 | `E2 / 本机` | `docker compose --env-file .env.local --profile full build app worker`、`docker compose --env-file .env.local --profile full ps`、`docker image inspect`、`scripts/audit.mjs` |
| 严格部署 preflight（显式运行时预算覆盖） | 5 pass、1 warning、16 failure；预算元数据门禁通过，但示例值未获用户/账户批准；应用层操作预算不等于 provider 账户硬支出上限，且 provider 凭据及生产发布事实仍缺 | `E1` | `WORLDLOOM_LLM_MAX_INPUT_TOKENS_PER_RUN=120000 WORLDLOOM_LLM_MAX_OUTPUT_TOKENS_PER_RUN=24000 WORLDLOOM_LLM_MAX_ESTIMATED_COST_USD_PER_RUN=1.5 pnpm deployment:preflight -- --strict` |
| 严格预检与 Compose 运行环境一致性 | 2026-09-24 旧服务凭据为空；2026-09-27 本机 4310 Compose app/worker 已按 `.env.local` 注入 DeepSeek 与 embedding 远程配置，脱敏存在性检查为 true，`/api/health` 的 LLM profile `configured/detected=true`。shell 严格预检仍默认忽略 `.env.local`，且没有获批账户级硬额度、告警及正式部署事实；本机调用可用不代表发布通过 | `E2 / 本机；发布未就绪` | `docker inspect` 脱敏存在性检查、`GET /api/health`、`pnpm deployment:preflight -- --strict` |
| LLM operation budget guard | CI run [35898154828](https://github.com/betterkite/WorldLoom/actions/runs/35898154828)，revision `602f2e7a58c18b529d5fd2d520992e8741189c7c`：配置后累计覆盖持久化 CompileRun 与问答、创世、推演、答案评测；同步操作按单次业务操作计，输出上限按剩余额度收紧，缺 usage、超 token/估算费用或 profile 不匹配时拒绝后续调用；这是响应后软停止，不是账户级限额 | `E1` | `pnpm test`；`tests/llm-usage-budget.test.ts`；`tests/eval-answer.test.ts` |
| API 可用性审计 | 2026-09-27 本机 4310 新镜像 53/53 通过；包含 live/readiness、治理链、检索、导出、MCP 和页面路由，清理仅删除本次唯一 fixture | `E2 / 本机` | `node scripts/audit.mjs http://127.0.0.1:4310` |
| UI 验收 | 2026-09-27 本机 4310 新镜像 42/42、FAIL 0、WARN 0；含 SVG fallback 完全遮挡 WebGL 重影断言，唯一 fixture 已删除 | `E2 / 本机` | `node scripts/ui-shots.mjs ...`、`node scripts/ui-acceptance.mjs ...` |
| 本地备份恢复（历史旧脚本） | 26 表、5 世界，临时数据清理；旧计数比较不证明新用量表/内容、长期备份或当前源码 | `E2 / 历史限定范围` | 历史 `pnpm db:backup:drill` |
| 本机同快照内容恢复演练（新源码） | 2026-10-01 补入 public 表内容/行数比较、已存在用量表核对、精确所有权及清理后通过、脱敏失败和模拟用例；没有运行测试或演练，不是长期备份 | `PENDING / E0` | 待恢复验证后执行 `pnpm db:backup:drill`；[BACKUP_RESTORE.md](./BACKUP_RESTORE.md) |
| 本地 embedding 容器验收 | remote 未配置时，容器使用 `Xenova/bge-m3` 索引 8 条，检索模式为 `hybrid` 并命中 8 条 | `E2` | `pnpm embeddings:download`；Full Compose；`POST /api/worlds/:id/semantic-index` + `/search` |
| 检索基准 | 2026-09-23 UTC 本机复测（macOS arm64、`Mac17,5`、6 CPU、8 GiB）：500 entities、2000 events，100 个串行 queries，P50 38.2ms、P95 48.7ms、max 67.0ms；基准驱动进程 RSS 增量 68.6 MiB，本机脚本门槛通过。仅本机 E2 基线，非并发吞吐或目标部署 SLO | `E2` | `pnpm benchmark:retrieval http://127.0.0.1:4310` |
| 本地 Compose 服务内存抽样 | 同次检索基准期间 Docker stats 流覆盖 6.01s、每容器 9 个快照：app 183.3→370.4 MiB、DB 47.1→59.8 MiB、已加载本地模型的 worker 1315.8 MiB；这些是抽样值，不是 cgroup 高水位或容量结论；只在 `localhost/127.0.0.1:4310` 采集当前仓库 Compose 指标 | `E2 / 限定范围` | 基准输出 `serviceContainerMemory`；Docker stats streaming，逐容器统计样本数 |
| 依赖 SBOM | 2026-09-30：移除旧命令依赖后最新为 343 个生产条目（当日此前 349）；UUID/PURL/工具字段已修正，完整官方 CycloneDX 1.5 schema 校验 PASS。含 lockfile、源码内容 SHA-256 与 dirty/clean 状态，`--release` 拒绝未提交源码和 revision 不一致；现运行旧镜像 19 个 npm 包名/版本再次全部匹配，但新源码未进入镜像、完整 browser/native/base 清单及远端 CI 尚未闭合 | `E1 / 本机` | `pnpm run sbom -- --output artifacts/worldloom-sbom.cdx.json`、`pnpm sbom:validate`；发布追加 `--release` |
| 新命令面板与错误恢复 | 2026-09-30 在 4311 隔离库生产构建 Chromium/Edge 各 16 项 E2E 通过，含选中样式、375px 手机及错误重试；截图抽查完成。未更新现有 4310 镜像 | `E1 / 本机` | `E2E_BASE_URL=http://127.0.0.1:4311 pnpm e2e`，Edge 加 `E2E_BROWSER_CHANNEL=msedge`；`docs/UI_ACCEPTANCE.md` |
| 真实模型合成闭环 | 2026-09-30 第二轮 19 项自动化检查通过、117.6 秒；v1→v4、远程 embedding HTTP 402 下本地索引就绪，34/34 fresh vectors、hybrid 命中。首轮语义步骤异常保留，agent 内容抽查非人工批准；代表性素材、非编译全成本和目标环境仍缺 | `E1 / 本机` | `node scripts/acceptance.mjs [baseUrl] [--keep-world]`；`docs/REAL_MODEL_ACCEPTANCE.md` |
| 本机生产镜像漏洞扫描 | 2026-09-24 对本机新构建 linux/arm64 app 镜像（image ID `sha256:53ac3d149376b572f6c986b83638a39491fdc31f13d9b836a79da56d3d395c18`）使用 Trivy `0.74.0`，Debian 13.7 与 node-pkg 扫描范围内 CRITICAL/HIGH 为 0，包含未修复项；漏洞库更新于 2026-09-23 UTC。只保留本机命令输出，未归档 machine-readable 报告；发布仍需对应 commit 的 CI artifact | `E2 / 限定范围` | `docker save worldloom-app:latest`；Trivy `image --input ... --scanners vuln --pkg-types os,library --severity CRITICAL,HIGH --ignore-unfixed=false --exit-code 1` |
| 生产运行时镜像安全扫描（本地复测） | distroless Node 24 Debian 13，Trivy `os,library` 严格扫描 `CRITICAL,HIGH` 为 0；仅证明该构建与扫描时点 | `E1/E2` | `docker build ...`；Trivy JSON 报告与 SHA-256 归档 |
| CI 证据关联索引 | 同一 commit 的 SBOM、不可变镜像 inspect、Trivy 漏洞结果、签名 provenance 和签名 SBOM attestation 校验结果已关联并生成 `EV-01` machine-readable index；注册表 digest、漏洞例外和独立复核仍需补充 | `E1 / CONDITIONAL` | GitHub Actions `evidence` job artifact；`node scripts/verify-build-evidence.mjs ... --vulnerability-report ... --provenance ... --sbom-provenance ...` |
| 本地 Compose 运行时硬化 | 2026-09-24 原服务 UID/GID `65532:65532`、healthy、只读根文件系统、`cap_drop: ALL`、`no-new-privileges`、PID 上限 256；rootfs 写入得到 `EROFS`，Next cache/tmpfs 可写，worker 临时任务领取与清理通过。2026-09-27 在保存原镜像回滚 tag 与数据库 custom dump 后，本机回环地址 4310 的 app/worker 换为新镜像，均 healthy；未运行迁移或变更 schema。新 app 镜像不含 `.env*`。DB 43133 仍只绑定 loopback，worker 无宿主机发布端口。严格运行时许可审计仍有 2 项缺口 | `E2 / 限定范围` | `docker compose --env-file .env.local --profile full config --quiet`、`docker compose --env-file .env.local --profile full ps`、镜像构建/UID/文件清单检查、`docker inspect`；仅本机证据，不证明 Docker 主机、生产网关或目标平台的完整 CIS 基线 |
| v0.1 OCI 开发候选 | 2026-09-30 app arm64/x64 和 migrate arm64 构建通过，安装阶段固定 pnpm 11.22.0。完整 ONNX 第三方告知与 libvips 组件告知已打包，app 严格审计各余 `client-only` 1 个邻接 notice 缺口、退出 1；完整原生许可仍待核对。迁移镜像 35 包/0 缺口，15 迁移在隔离 DB 通过；app 两架构各 14 个系统包、迁移 81 包均有版权文件。arm64 只读非 root OCI 的 live/ready 200、healthy，Chromium/Edge 各 16 E2E、53 API/页面审计通过；测试资源已清理，现有五个用户世界不变。未更新 4310、未远端 CI、不是最终 clean-commit 制品 | `E1/E2 / 本机限定范围` | `docs/RUNTIME_LICENSE_AUDIT.md` 的镜像身份与核验范围；本机忽略的 `artifacts/worldloom-v01-*.json` |
| Full Compose 多副本拓扑 | CI run [35894596744](https://github.com/betterkite/WorldLoom/actions/runs/35894596744)，revision `00d591d97ba381b313faaa803622874a5581d339`：`db → migrate → app + worker × 2` 启动成功，两个 worker health 均通过；同一 run 的 DB 集成测试验证并发 executor 仅触发一次模型调用。此记录单独只证明 Compose 扩容和数据库 CAS，不证明生产 HA、全局并发预算或 SLO | `E2` | `docker compose --profile full up -d --build --scale worker=2`、`docker compose --profile full ps`、`pnpm test` 中 `allows only one concurrent executor to claim a durable run` |
| Compose worker 副本独立领取探针 | CI run [35903165178](https://github.com/betterkite/WorldLoom/actions/runs/35903165178)，revision `ba35c1c36b615f2993514501fbbb1f75b3d53467`：两个不同 worker 容器 ID 依次单独运行；每个副本各自领取一条独立 queued `SemanticIndexJob`，均记录 `attempts=1`、`recoveryAttempts=0`、`indexed=0` 与开始/结束时间，然后因 CI 未配置 embedding 而进入已知安全终态。探针使用空 fixture，不调用 provider；临时世界清理。只证明该 Compose 配置中两副本都能分别领取并处理队列状态，不证明 provider 索引成功、并行吞吐、生产 HA、容量或 SLO | `E2 / 限定范围` | GitHub Actions `container` job：Full Compose runtime smoke test；`node scripts/worker-replica-claim-smoke.mjs`（由 CI 对每个 worker 副本分别隔离执行） |
| 独立 Worker runtime smoke | 2026-09-23 UTC 本地 full Compose 复测：独立 worker 领取 queued `SemanticIndexJob`，`attempts=1`、`recoveryAttempts=0`，完成并持久化 1 个向量；实际走本地 `Xenova/bge-m3`，未配置远程 embedding 凭据；临时世界已清理 | `E2` | full Compose + 本地模型；`pnpm worker:smoke` |
| 独立 Worker stale recovery | 2026-09-23 UTC 本地 full Compose 复测：独立 worker 重新领取过期 heartbeat 的 `running` 任务，`attempts 1→2`、`recoveryAttempts=1`，完成并持久化 1 个向量；临时世界已清理 | `E2` | full Compose + 本地模型；`pnpm worker:recovery-smoke` |
| 独立 Worker kill/restart recovery | 2026-09-23 18:57 UTC 实际 `SIGKILL` worker 后同一容器 `StartedAt` 改变（容器 ID 未变，Docker `RestartCount` 仍为 0）；lease 过期后 `attempts 1→2`、`recoveryAttempts=1`，64/64 索引完成且向量 64 条无重复；临时世界已清理，复测后 worker health 正常且无活动任务 | `E2` | full Compose + 本地模型；`pnpm run worker:chaos-smoke -- --timeout-ms=180000 --entities=64`；脱敏输出已留存 |
| v0.1 worker 隔离故障与重投 | 2026-09-30 固定 arm64 候选，专用 tmpfs DB 各应用 15 迁移，无 provider 凭据。SIGKILL/lease 恢复/重投：128 条、attempts 1→2→3、recoveryAttempts=1；双 worker 在场：64 条首次 attempts=1、重投后=2，recoveryAttempts=0；两者向量均非空、1024 维且目标唯一。fixture、容器、网络已清理，原 3 个产品容器 ID/StartedAt 不变且 healthy、5 个用户世界不变。非目标容量/生产 HA 结论 | `E2 / Agent 本机观察，限定范围` | [WORKER_DRILL.md](./WORKER_DRILL.md)；旧无 scope 故障命令现在被拒绝 |
| CI / 容器 / E2E | 以对应 commit 的 GitHub Actions 为准；漏洞门禁失败时必须登记失败报告和修复后的复跑 run，不得只保留成功截图 | `E1/E2` | `gh run view <run-id>` |

## 11. 证据索引

每个证据条目至少包含：证据 ID、执行时间（UTC）、执行人、环境、命令/工具版本、输入数据
摘要、期望结果、观察结果、状态、原始记录位置、哈希或不可变链接、复核人。

| 证据 ID | 标题 | 原始记录/报告链接 | SHA-256/报告编号 | 执行时间 | 复核人 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| EV-01 | 发布身份、SBOM、CI | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-02 | 认证、网络隔离、限流 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-03 | TLS、HSTS、响应头 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
| EV-04 | provider、预算、embedding 回退与 LLM/RAG/MCP 安全 | `待填写` | `待填写` | `待填写` | `待填写` | `PENDING` |
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
- [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework)：网络安全治理、风险管理与 Govern / Identify / Protect / Detect / Respond / Recover 结果的高层映射参考，不是认证或逐项技术检查清单。
- [NIST Privacy Framework](https://www.nist.gov/privacy-framework)：隐私风险企业风险管理的自愿框架。本模板固定已发布的 v1.0；NIST 的 v1.1 页面标示为后续更新/公开草案，采用前须确认正式发布状态并重新评估映射。
- [ISO/IEC 27001:2022](https://www.iso.org/standard/27001) 与 [ISO/IEC 27002:2022](https://www.iso.org/standard/75652.html)：前者规定 ISMS 要求，后者提供信息安全控制指导；27002 本身不提供认证，本模板的交叉映射不代表组织级认证或完整控制评估。
- [ISO/IEC 27701:2025](https://www.iso.org/standard/27701)：隐私信息管理体系要求与指导，适用于个人可识别信息控制者/处理者；需按正式版本及实际角色固定条款，不能代替法域法律评估。
- [ISO/IEC 42001:2023](https://www.iso.org/standard/42001)：人工智能管理体系要求；本模板仅将其用于 AI 系统治理证据映射，不代表 AIMS 符合或认证。
- [AICPA 2017 Trust Services Criteria（2022 Points of Focus 修订）](https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022)：SOC 2 鉴证的控制评价依据之一；适用类别和期间应由组织与独立 CPA 明确，模板记录不能替代 SOC 2 报告。
- [OWASP Application Security Verification Standard 5.0.0](https://owasp.org/projects/asvs)：Web 应用及其依赖环境技术控制的可验证要求；引用控制项时固定版本，使用 `v5.0.0-<requirement-id>` 格式。
- [OWASP API Security Top 10 2023](https://owasp.org/www-project-api-security/)：API 风险识别、威胁建模和测试覆盖参考，不是认证标准；本模板将类别映射到可复核的负向测试。
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)：Docker daemon、主机与容器运行时安全配置指南；本模板基于当前官方可获取的 1.8.0 版本，逐项适用性需结合部署环境确认。
- [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes)、[Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) 与 [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/)：仅用于 Kubernetes 部署；按目标集群版本固定 CIS Benchmark，使用平台原生/等效准入策略并保留负向验证证据。
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/)：识别 LLM 应用提示注入、敏感信息泄露、输出处理、供应链和过度代理权限等风险的参考；不代表完整或通过验证。
- [NIST AI 600-1 Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1)：将生成式 AI 风险纳入 AI RMF 生命周期风险管理的自愿参考。
- [Google SRE Data Integrity](https://sre.google/sre-book/data-integrity/)：区分备份与可恢复性，要求以实际恢复能力、数据完整性和可接受的数据丢失量驱动设计。
- [Google Cloud Disaster Recovery Scenarios for Data](https://docs.cloud.google.com/architecture/dr-scenarios-for-data)：RPO/RTO、恢复目标与数据库备份/日志链路的记录方式参考。
- [Google SRE Canarying Releases](https://sre.google/workbook/canarying-releases/) 与 [Production Services Best Practices](https://sre.google/sre-book/service-best-practices/)：分阶段发布、用户相关 SLI/SLO、监控和回滚决策的指导性实践，非认证标准。
- [SLSA v1.2 specification](https://slsa.dev/spec/v1.2/)、[Build requirements](https://slsa.dev/spec/v1.2/build-requirements)、[Distributing provenance](https://slsa.dev/spec/v1.2/distributing-provenance) 与 [Verifying artifacts](https://slsa.dev/spec/v1.2/verifying-artifacts)：构建 provenance、制品摘要和消费者在安装/部署前验证制品的链路参考；实际声明的 Build Level 必须按该版本要求核实；若实现使用其他 predicate/attestation 版本，应在证据中固定格式版本和验证方式。
- [GitHub Artifact Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) 与 [`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify)：签名制品证明、subject 绑定和验证输出参考。
- [Trivy image scanning](https://github.com/aquasecurity/trivy) 与 [Trivy Action](https://github.com/aquasecurity/trivy-action)：容器 OS/语言包漏洞扫描、阈值和 CI 集成参考。
- [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)：事件准备、检测、响应、恢复和复盘参考。
- [OpenTelemetry Logging Specification](https://opentelemetry.io/docs/specs/otel/logs/)：日志与 trace/span/request context 的关联参考。
- [Kubernetes Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) 与 [Pod Lifecycle / termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)：仅用于 Kubernetes 部署，参考探针职责区分、终止宽限期及流量排空/优雅终止证据。

项目自身的安全边界和门禁仍以 [DEPLOYMENT_SECURITY.md](./DEPLOYMENT_SECURITY.md)、
[ACCEPTANCE.md](./ACCEPTANCE.md) 和 [ISSUES.md](./ISSUES.md) 为准。
