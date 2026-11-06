# 核心工程智能与令牌优化设计

[English version](2026-11-06-core-intelligence-and-token-optimization.md)

## 背景

在多轮软件工程任务进行过程中，模型常常积累大量冗余上下文、重复搜索查询以及对同一文件的重复范围读取。此外，常规上下文压缩机制往往在生成摘要时丢失关键工程状态——例如架构不变量、符号级代码差异锚点以及根本原因假设——导致长会话中的幻觉或回归缺陷。当测试命令或编译输出超出预览限制时，原本截断算法会丢弃中间的关键调用栈和失败诊断信息，使模型缺失定位错误所需的必要线索。

## 决策

1. **上下文压缩工程状态保留 (`prompts.ts`)**:
   增强 `getCompressionPrompt()`，加入明确的高优先级保留指令，涵盖：
   - 架构不变量与关键系统约束。
   - 所有已修改文件的准确相对路径。
   - 符号级差异锚点与行级改动内容。
   - 跨工作区的活跃 diff 概要。
   - 根本原因推导结论与已排除的无效假设。
   - 待执行的验证命令与尚未解决的测试失败项。

2. **智能文件范围读取与去重 (`fileReadCache.ts`, `read-file.ts`)**:
   扩展 `FileReadCache` 以跟踪 `FileRange`（起始行 `startLine` 至结束行 `endLine`）和单调递增的 `writeGeneration`。当针对未变更文件连续发起相同范围读取时，`read-file` 快速返回 `unchangedRangeResult` 占位符，消除冗余上下文消耗，同时严格遵守“部分读取绝不重新授予全文占位符权限”（`readResidentInHistory` Codex P2 不变量）。

3. **诊断感知型输出截断 (`truncation.ts`)**:
   引入诊断特征匹配 (`DIAGNOSTIC_PATTERNS`)，覆盖单元测试框架（vitest、jest、mocha、pytest）、编译器（TypeScript、Rust、Go）以及运行时异常栈。当工具输出超出预览预算并省略中间行时，截断分隔符中保留提取出的失败诊断行（`[Key Diagnostic Excerpts from Truncated Output]`），确保模型始终能看到关键报错。

4. **幂等搜索记忆化缓存 (`grep.ts`, `glob.ts`)**:
   为 `GrepTool` 与 `GlobTool` 增加受容量限制的 LRU 搜索缓存，以查询参数和 `fileReadCache.getWriteGeneration()` 作为键。在工作区未发生文件写入变更时，重复探索直接命中内存，零磁盘 I/O、零子进程调用、零冗余后续消耗。

## 消费方和边界

- `FileReadCache` 提供由 `recordWrite`、`invalidate`、`invalidateByPath` 和 `clear` 驱动的单调 `writeGeneration`。
- `ReadFileTool` 使用 `fileReadCache.getLastReadRange()` 与 `fileReadCache.recordRead()`。
- `TruncationService`（`truncateText`、`truncateSharedOutput`）调用 `extractDiagnosticLines()`。
- `GrepTool` 和 `GlobTool` 读取 `fileReadCache.getWriteGeneration()`。
- 本设计不改变用户 CLI 行为，也不降低模型的思考推理预算；所有优化均作用于执行工作流与上下文净化层面。

## 限制

- 范围读取去重仅匹配相同的 `startLine` 和 `endLine`；交叉或子范围读取仍执行真实读取以确保上下文完整。
- 诊断行提取受 `previewBudget` 严格约束；若可用空间不足（< 1/3），平滑降级为紧凑分隔符。
- 工作区发生任何写操作后，搜索缓存立即全量失效，杜绝脏读。

## 验证

- 在 `prompts.test.ts`、`fileReadCache.test.ts`、`read-file.test.ts`、`truncation.test.ts`、`grep.test.ts` 及 `glob.test.ts` 中补充回归测试。
- 全仓类型检查通过（`npm run typecheck`）。
- 离线十项工程基准测试验证通过（10/10 全部通过）。
