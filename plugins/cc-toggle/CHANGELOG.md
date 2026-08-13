# Changelog

## v1.6.0

- 桌面小组件：当前供应商余额置顶小窗，默认显示余额/模型名/备注，默认深色主题

## v1.5.0

- 插件 ID 统一为 `cc-toggle`，数据目录统一为 `~/.ztools-cctoggle/`
- 余额不足告警按项目级持久化去重：告警标记存于项目文档 `balanceNotify`，跨会话不重复推送，余额回升再跌破时才重新提醒

## v1.4.0

- 一键切换供应商：为 Codex、Claude、Gemini、OpenCode、OpenClaw 等主流 AI CLI 工具管理多套 API 配置
- 切换 baseUrl、模型、密钥等参数，无需手动改配置文件
- ZTools 化：仓库链接 / 端口区分 / env 开发目标
- 同步 OpenClaw 会话模型记忆
