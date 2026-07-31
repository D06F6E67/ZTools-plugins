# 系统管家

系统管家把四项常用的本地维护能力发布为一个 ZTools 插件，并保留各模块独立的安全边界、测试与可审核 preload 源码。

![系统管家统一首页](screenshots/main.png)

| 功能 | Feature code | 主要边界 |
|---|---|---|
| 应用彻底卸载 | `application-uninstaller` | 完整预览、用户级范围、明确确认后移入废纸篓 |
| 开机启动管理 | `startup-manager` | Linux/Windows 受控用户项可撤销；macOS 启动项只读 |
| 垃圾清理 | `system-cleaner` | 白名单目录、预览优先、可恢复删除 |
| 局域网设备发现 | `lan-device-discovery` | 被动邻居表与受限 ICMP，不做端口或漏洞探测 |

四个 Feature 均显式支持 macOS、Windows 和 Linux。实际可见项目和系统命令仍受当前平台、权限与桌面环境影响。

## 单插件结构

```text
system-manager/
├── public/                  # 根 manifest、dashboard 与统一 preload
├── modules/                 # 四个可独立测试、仅供套件组装的内部模块
├── scripts/                 # 顺序构建、组装、审计与 ZIP 生成
├── tests/                   # workspace、路由和最终发布物整合测试
├── dist/                    # 单一 ZTools 发布目录（构建生成）
└── release/system-manager-0.1.0.zip
```

最终 `dist` 只保留根 `plugin.json`。模块发布物位于 `dist/modules/<feature-code>/`，其嵌套 manifest 会在组装时删除。每个模块 HTML 都会注入一个键盘可聚焦的“返回系统管家”链接，共用 `_system-manager/navigation.js` 和 `_system-manager/navigation.css`。

根 preload 只额外暴露：

```js
window.systemManagerSuite.openFeature(featureCode)
```

`featureCode` 必须命中四项固定 allowlist。未知、继承属性或越界路由会返回 `false`。四个模块原有的窄桥接口仍由其可读 CommonJS preload 提供。

## 开发与验证

依赖统一通过 npm workspaces 安装；建议显式把缓存放在插件目录：

```bash
npm_config_cache="$PWD/.npm-cache" npm install
npm_config_cache="$PWD/.npm-cache" npm test
```

`npm test` 会执行以下完整链路：

1. 按固定顺序执行四个 workspace 的 `build:dist`；各模块仍运行自身 typecheck 与测试，并删除中间 manifest 和旧的独立 release，不能作为单独插件发布。
2. 复制 dashboard、根 manifest/preload 和四个模块 dist。
3. 删除嵌套 `plugin.json`，向模块 HTML 注入返回导航。
4. 验证四个 Feature、三平台声明、preload 依赖、路由 allowlist 和发布内容。
5. 拒绝 source map、`node_modules`、开发目录、符号链接和不可审核 preload。
6. 为 dashboard 与四个模块统一注入严格生产 CSP，移除开发服务器和 `unsafe-inline` 来源。
7. 通过同目录临时文件和原子 rename 生成 ZIP，并逐 entry 校验名称、CRC、长度、压缩方法、local/central 偏移、重复项及与当前 dist 一致的 SHA-256；rename 前同步文件，rename 后同步发布目录（平台支持时）。
8. 对 `dist` 与 ZIP 分别执行严格 `< 15 MiB` 门禁。

单独重新校验或打包：

```bash
npm run verify
npm run package
```

## 隐私与限制

- 所有数据默认只在本机处理，不由系统管家上传。
- 卸载、启动项修改和垃圾清理均属于有副作用操作，必须在模块内完成预览与确认。
- 局域网发现仅使用本地邻居信息和受限 ICMP；ICMP 无响应不代表设备离线。
- 详细威胁模型、路由与发布边界见 [SECURITY.md](SECURITY.md)。
