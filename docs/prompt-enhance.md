# CodexHost 原生 Prompt Enhance

本分支基于 `floating-life/codex-host` 的 v0.6.1（上游提交 `fd912b8`），不需要 Codex++。增强服务与当前执行任务的 Harness 独立。源代码改动不会自动安装到已运行的桌面进程。

## 使用

1. 默认使用手动配置，无需设置环境变量。请在设置页的 API Key 密码框输入 Key，不要粘贴到任务聊天中。
2. 运行本分支构建的 CodexHost，在原生设置中打开 **Prompt Enhance**，或右键 Composer 旁的星芒按钮。
3. 勾选启用，填写 Base URL、模型 ID、协议与 API Key，点击保存。下一次增强立即使用新设置，无需重启；已发出的请求继续使用原配置。Base URL 应包含服务要求的 `/v1`，但不要包含 `/responses` 或 `/chat/completions` 后缀。远程服务要求 HTTPS；HTTP 仅允许明确的 loopback 地址。不支持 URL 内嵌账号密码或 query 参数。
4. 写好草稿后点击星芒增强。再次点击停止；结果完整且原文和编辑对象未改变时自动回填，由你检查后自行发送。
5. 撤销按钮只恢复本轮增强；手工改稿、切换编辑对象、输入法编辑中或原生历史不匹配时不会覆盖。不能回填的完整结果可从设置页复制。

编辑已经发出的消息时，编辑表单的“发送”旁也提供相同的增强/停止/撤销入口。增强只改当前编辑框；点击原生“发送”后才提交消息修改。取消编辑、切换消息或手动改稿后不会写入晚到的结果。耗时分析和验证范围见 [时延与消息编辑说明](prompt-enhance-latency-and-message-edit.md)。

配置位于 Host 的 `CODEXHOST_DATA_DIR/prompt-enhance.json`；默认目录为用户目录下 `.codexhost`。手动 Key 保存在本机 Host 配置文件中，不写入浏览器存储、不通过配置读取接口回显。密码框留空保留已有 Key，勾选“清除已保存的 Key”才删除。环境变量保留为显式选择的高级选项。不会自动复用 ChatGPT OAuth、当前任务模型或执行 Harness 的账号。保存设置不调用模型，实际增强可能产生 API 费用。

失败提示显示在输入栏外的浮层，可点击 × 关闭，6 秒后自动隐藏，悬停暂缓隐藏。关闭提示不会取消生成，停止生成仍点击增强按钮。界面提示 Host 版本不匹配时，需要完整退出并重新打开 CodexHost；这是安装新版 Host 所需的一次启动更新，不是每次更改模型配置都要重启。

## 支持边界

- WorkBuddy 风格（约 800 字符的模型指导，不硬截断）与创意展开两种模式；保留意图、代码和约束，只有当前草稿发送给 Provider。
- Chat Completions 和 Responses 的 JSON/SSE 响应；拒绝截断、不完整或错误终态。90 秒超时，无自动重试。Responses 默认 `store:false`。
- 原生 ProseMirror 使用事务与单轮撤销，不直接改 DOM。未知编辑器禁用增强，不猜测内部接口。
- 本版不保证与 WB 1.5.5 字节级模板/外观一致；不包含模型列表拉取、生成连接测试、8 次诊断历史、逐 token 预览或 `omit store` 兼容开关。进度目前显示忙碌/结果状态，不显示接收字节数。
- 页面刷新会清除内存中的撤销与最近结果。不要依赖它存储重要草稿。

## 从源码构建

使用仓库要求的 Node 22.19+（22 系列）或 Node 24，运行 `npm ci`、`npm run build:typescript`、`npm run build:renderer`。完整本地桌面运行还需要 Rust 工具链与仓库的 `npm start`；该命令会停止现有 Codex Desktop 进程，必须先保存工作并在合适时机执行。构建命令本身不自动启动或覆盖现有安装；安装后的真实 Provider 请求应单独验证并注意费用。

## 升级后恢复

官方 CodexHost 安装器升级时会重写 `app/host-runtime.mjs` 和 `app/renderer-extension.js`。启动器只读取这两个 canonical 文件；即使旧的增强 bundle 仍作为旁置文件存在，也不会被加载。因此升级后增强按钮消失属于安装文件被官方 bundle 覆盖，不是 API Key 或 Provider 配置丢失。

恢复时退出 CodexHost，基于当前分支重新构建 Host/Renderer bundle，备份安装目录中的两个 canonical 文件后再替换，最后完全退出并重新打开 CodexHost。配置文件 `~/.codexhost/prompt-enhance.json` 会保留，但正在运行的进程不会自动重新加载新 bundle。若继续使用官方自动更新，后续版本仍可能再次覆盖本地 bundle；长期使用应从包含本模块的 fork 构建安装包，或在每次升级后重复上述恢复步骤。

## 长期同步 fork

`origin` 为 `https://github.com/floating-life/codex-host.git`，其父仓库为 `https://github.com/BytePioneer-AI/codex-host`。本次没有创建定时同步、推送、合并或发布。

建议保留功能分支，另行配置 `upstream` 指向父仓库；更新时先 fetch 和检查差异，在独立分支整合，再重新验证编辑器契约与下列测试。不要把 GitHub 的 Sync fork、源码合并和桌面安装包自动更新混为一谈。安装官方构建可能不包含本分支的增强模块。

功能代码分别独立放在 Host/Renderer 现有包中，以遵守 Node 与浏览器的依赖边界；核心接入仅涉及 Host 请求分派、Renderer 客户端、绑定生命周期及设置生命周期。没有为了单个功能引入第二套启动器或脚本加载框架。

回归入口：

```powershell
npm run typecheck
npm run build:renderer
npx vitest run --config tests/vitest.config.js packages/host-runtime/test/prompt-enhance.test.ts packages/renderer-extension/test/renderer-enhancement-client.test.ts packages/renderer-extension/test/renderer-prompt-enhance.test.ts packages/renderer-extension/test/renderer-prompt-enhance-editor.test.ts
npx playwright test --config tests/e2e/playwright.config.js tests/e2e/renderer-prompt-enhance-binding.spec.ts --workers=1
node tools/check-boundaries.mjs
```

## 来源

行为参考用户提供的 WB Enhance Prompt 1.5.5-share；原分享包保持不变。它是社区作品，不是 WorkBuddy/Augment 官方产品。本实现重新组织了模块与提示模板；原脚本中图标的 ISC 声明不能当作整个分享包的分发许可。对外发布涉及原脚本衍生代码前，应确认相应授权。
