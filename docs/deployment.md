# Deployment

## Source build

```bash
npm ci
npm run build:typescript
npm run build:renderer
npm run build:rust
```

使用 `npm start` 会停止匹配到的 Codex Desktop 和 CodexHost 开发进程，然后使用当前工作树启动；请先保存草稿和正在运行的任务。官方安装包构建使用仓库已有 release scripts；本地 Prompt Enhance 改动不会自动进入上游发布包。官方安装器升级也可能覆盖已安装的 Prompt Enhance bundle，升级后应按 [升级后恢复](prompt-enhance.md#升级后恢复) 重新部署并重启桌面。

## Local Windows installation

退出桌面后备份原文件，再替换构建产物，启动后检查 Renderer binding 和 Prompt Enhance 设置页。回滚只需恢复备份。详见 [Prompt Enhance 使用与安装说明](prompt-enhance.md)。

## Configuration

Prompt Enhance 默认使用手动凭据。设置页保存 Base URL、协议、模型和 Key；Host 配置文件只返回 `hasApiKey`，不会通过 Renderer 回显 Key。配置文件位置为 `CODEXHOST_DATA_DIR/prompt-enhance.json`，默认 `~/.codexhost/prompt-enhance.json`。远程 Provider 使用 HTTPS；loopback HTTP 仅用于本机网关。不要把包含手动 Key 的配置文件提交或打包。

环境变量凭据模式仍可显式选择，但不会自动复用 ChatGPT OAuth。切换 Provider 或 Key 后，下一次增强立即读取新配置；正在进行的请求继续使用发起时快照。

## Release limits

发布前还需独立验证真实安装包、目标 Codex Desktop 版本、目标 Provider 和回滚流程。本地测试通过不等于跨版本兼容、发布或训练准入证据。
