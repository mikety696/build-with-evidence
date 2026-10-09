# 06 · Qoder 工具链：把手册变成可执行的回路

原则：**流程里凡是靠人肉坚持的环节，早晚会失守。** 把每个阶段落到已有能力上。

## 1. 阶段 → 能力映射

| 阶段 | 能力 | 用法 |
|---|---|---|
| 0 基线 | 项目知识层 `SearchKnowledge` / `qmind` | 让 AI 先读仓库知识（模块划分、约定、启动方式）再动手；把文档/链接导入知识库复用 |
| 0 基线 | `AGENTS.md` / `QODER.md` | 契约常驻，跨会话生效 |
| 1–2 澄清与方案 | **Plan 模式** + `Plan` 子智能体 | AI 出计划 → 你审批 → 才写文件；架构取舍交给规划型代理 |
| 1–2 选型 | `WebSearch` / `WebFetch` / `find-extensions` | 需要最新库信息或新能力时先查现成扩展，避免重复造轮子 |
| 3 拆分 | `TaskCreate/TaskUpdate/TaskList` | 任务状态、依赖顺序可视化，不靠记忆 |
| 4 实现 | 主代理 + `Explore` 子智能体 | 探索类大范围检索外包给只读代理，保护主上下文 |
| 4 验证 | `Bash` / `node-repl` MCP | 命令真实输出；算法/脚本用 node-repl 即时验证 |
| 4–5 UI 自证 | `browser-use` MCP | 导航、截图、快照、console 与网络请求、点击/填表 → 前端「完成」的唯一有效证据 |
| 5 评审 | `general-purpose` / `Explore` 子智能体（新上下文） | 独立视角审查 diff；并行跑安全/性能/可读性三路检查 |
| 5 安全 | `mcp-config` skill | 按需接入扫描器/内部平台类 MCP 服务 |
| 6 网站交付 | `sites-building` / `sites-hosting` / `sites-management` + `qoder_sites` MCP（47 工具） | 建站、部署发布、域名/访问策略/迁移/存储/密钥/分析 |
| 6 沉淀 | `qoder-qmind` MCP（6 工具） + `skill-creator` | 决策与踩坑回写知识库；重复工作流固化成 skill |
| 6 汇报 | `Presentations:pptx` | 方案/复盘材料直接成稿 |

## 2. MCP 的正确用法（懒加载环境）

MCP 工具不直接出现在工具列表里，用三个元工具：
- `mcp_list({keyword, includeDescription})` 发现能力
- `mcp_get({toolName})` 看输入结构
- `mcp_call({toolName, arguments})` 调用

提示词层面：**当你要 AI 使用外部系统时，让它先 list/get 再 call**，避免它凭记忆猜参数结构。新增外部服务时用 `mcp-config` skill 交互式配置服务器，改完重启/重连会话生效。

## 3. 子智能体的使用纪律

- 值得外包：跨多文件的探索、需要多次检索的对比调查、独立视角的代码评审、并行执行的互不依赖任务。
- 不值得外包：单点查文件（直接 Read/Grep）、需要主上下文判断的架构决策。
- 简报要完整：子智能体看不到当前对话，必须交代背景、目标、已排除项、期望输出格式与长度。
- **信任但验证**：子代理的总结是它的意图陈述，不等于事实。它写了代码就要看 diff、要跑命令。

## 4. 知识层：qmind / SearchKnowledge

- `SearchKnowledge`：本工作区已生成知识时，按标题 fetch 模块架构、约定、启动方式；改模块前先加载，避免与既有约定冲突。
- `qoder-qmind` MCP：`list_notebooks` / `list_sources` / `retrieve` 做证据检索；`add_source` / `read_source` / `get_source` 把需求文档、API 规范、设计规范、内部约定变成可检索上下文。
- 收益：把「每次会话重新解释一遍」变成「一次导入，长期复用」；对**长周期项目、多协作者、跨会话**的质量一致性影响最大。

## 5. 扩展自己：find-extensions 与 skill-creator

- 缺能力时的顺序：**现成 MCP/插件 → 写成 skill → 自己写脚本**。用 `qoder-find-extensions` 检索 Skills/MCP/Plugins 市场与 skills.sh，比较后再安装。
- 同类任务做到第三次 → 用 `skill-creator` 固化成 skill（含话术、检查项、验收标准）。这是把个人经验变成团队基线的机制。

## 6. 网站交付回路（sites 插件）实操建议

1. `sites-building`：明确数据来自后端/数据层，文案集中；改前给变更计划。
2. 本地验证：`browser-use` 截图 + console + network 全绿，四档视口。
3. 后端能力：`ensure_backend`、数据库迁移工具链、Storage 与密钥（密钥只留元数据，不写入站点代码）。迁移与兼容规则见 [playbook/04](extensibility-security.md)。
4. 需要 AI 对话/研究/流式输出时用 `sites-build-agent-app`（同一插件的能力扩展，不是替代品）：Agent 跑在后端，客户端零密钥；越权 PoC 必须失败。
5. `sites-hosting`：发布前向用户展示发布确认（`show_publish_confirmation`），**得到确认再 publish**——上线是对他人可见的动作。
6. `sites-management`：`get_publish_status` / `list_deployments` / `get_analytics` 复核；出问题用 `resume_site` / 回滚到上一个 release，而不是原地乱改。

## 7. 建议的「高质量默认回路」

```
读知识层(SearchKnowledge/qmind) → Plan 模式出 2 方案 + 取舍 → 你批准
→ 任务拆分 → 实现（先失败测试） → 聚合校验命令(test+typecheck+lint+build)
→ browser-use / node-repl / Bash 真实运行自证
→ 独立上下文评审（安全 / 性能 / 可维护性 三路）
→ 影响面与回滚清单 → 发布（需你确认） → 知识回写 + AGENTS.md 更新
```

把这个回路写成 skill 或模板贴进 `AGENTS.md`，每个功能都跑一遍——**质量来自回路的重复执行，不是来自某次灵感式的提示。**
