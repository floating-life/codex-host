# Contributing

感谢你愿意改进 CodexHost。提交前请先阅读 [AGENTS.md](AGENTS.md)，并确认改动符合包边界和原生 Harness 保真原则。

## 开发环境

- Node.js 22.19+（22 系列）或 24
- Rust toolchain（完整构建需要）
- 官方 Codex Desktop（桌面集成测试需要）

```bash
npm ci
npm run typecheck
npm run build:renderer
```

保持改动聚焦，不提交 `node_modules`、构建产物、`.local-install`、日志、凭据或真实用户数据。新增行为应有针对性测试；涉及 Renderer 时同时检查浏览器安全边界和生命周期销毁路径。

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:typescript
git diff --check
```

完整 Rust 检查可运行 `npm run check:rust`。真实桌面或 live Provider 测试不得携带私人草稿、聊天历史、附件或 API Key，并应在说明中区分本地验证与发布证据。

Pull Request 请说明问题、行为变化、测试命令和未验证边界。UI 改动附截图或浏览器测试证据；不要把模型名称、自报完成状态或小样本结果当作性能或兼容性证明。
