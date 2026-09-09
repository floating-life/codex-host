# 在 CodexHost 里加入原生 Prompt Enhance：一次本地实践

项目地址：<https://github.com/floating-life/codex-host>

## 背景

我长期使用 CodexHost，把 Codex Desktop 当作统一界面，在其中切换 Codex、Claude Code、Pi、Grok 等不同 Harness。实际协作时，经常只写下一句很短的草稿，模型需要自己补齐目标、边界、测试和验收条件。于是我希望把“发送前整理 Prompt”放进 CodexHost，而不是再安装另一套 Renderer 注入器。

这次实现参考了社区里的 [WB Enhance Prompt 文章](https://linux.do/t/topic/2860395) 和 [另一篇相关实践](https://linux.do/t/topic/2825164)。感谢两位作者分享思路、模板和使用经验；我只是在 CodexHost 的现有 Host/Renderer 边界上做了一个本地实现，不能代表原作者或原项目。

## 它解决什么问题

写好草稿后，点击输入框旁的增强按钮，Prompt Enhance 调用单独配置的 Provider，返回一份更清楚的任务描述，再回填到当前编辑框。用户仍然检查结果并点击原生发送。它不自动发送，也不读取聊天历史、附件或代码库。

## 主要功能

- WorkBuddy 风格和 Creative 两种模式。
- 手动填写 Base URL、API Key、模型和协议；保存后下一次请求立即生效。
- Chat Completions / Responses 的 JSON 和 SSE 完整响应校验。
- 请求取消、90 秒超时、错误浮层自动隐藏和手动关闭。
- 原生 Composer 与“编辑已经发出的消息”窗口都支持增强、停止和单轮撤销。
- 草稿被修改、消息切换、React 编辑对象变化或输入法仍在编辑时，拒绝晚到结果覆盖。
- ProseMirror 使用原生事务，不直接替换 DOM；未知编辑器 fail closed。
- 完成事件后不再等待服务端额外关闭流；普通聊天区域的文字更新不会触发全量增强入口扫描。

## 使用方式

```bash
git clone https://github.com/floating-life/codex-host
cd codex-host
npm ci
npm run build:typescript
npm run build:renderer
```

Windows 本地安装、配置和回滚说明见 [`docs/prompt-enhance.md`](prompt-enhance.md) 与 [`docs/deployment.md`](deployment.md)。第一次更新后需要完全退出并重新打开 CodexHost；之后修改增强设置不需要重启。Clash 虚拟网卡可能影响网关首响，建议保持已经验证可用的网络路径。

## 当前完成情况

在本地构造的 Host/Renderer 测试中，83 项针对性测试和 8 项浏览器测试通过；类型检查、Renderer 构建、边界检查和 ESLint 也通过。曾用一条不含私人内容的待办需求调用本机网关，实际返回成功。真实响应的两次测量约为 8.43 秒和 11.96 秒，主要等待发生在 Provider 返回响应头之前，因此目前不能把这项实现描述成“明显加速”。

## 仍有限制

还没有把 WB Enhance 1.5.5 的所有外观、模型列表、连接测试、完整诊断历史和逐 token 预览逐项复刻；也没有证明所有 Codex Desktop 版本都兼容。官方安装包更新可能覆盖本地改动。手动 Key 保存在本机 Host 配置中，发布前请确认权限、备份和回滚策略。

## 后续计划

后续会优先做同一 Provider 下的可重复延迟测量、可选低延迟模型配置、更多真实 Desktop 版本验证，以及更清晰的安装更新流程。任何性能结论都会区分模型质量、首响、尾延迟和网络条件，不用单次成功代替长期证据。

再次感谢 linux.do 社区和上述两篇分享文章。这个实现目前更像是一次面向自己工作流的工程实践，欢迎指出兼容性问题和设计上的不足。
