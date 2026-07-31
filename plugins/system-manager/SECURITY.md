# 系统管家安全说明

## 信任边界

系统管家由普通 Web UI 与 ZTools preload 两层组成。UI 不获得 `fs`、`child_process`、Shell 或任意路径访问能力；本地操作只能通过各模块已审计的窄接口执行。

根 `window.systemManagerSuite` 仅提供 `openFeature(featureCode)`。路由由无原型、冻结的固定表驱动，只接受四个 manifest Feature code，并校验协议和 origin。它不接受 URL、文件路径或命令。

## 模块边界

- 应用卸载：候选路径必须由受控平台适配器产生；macOS Bundle ID、desktop/Flatpak/AppImage 元数据和 Windows 卸载注册表均视为可变声明。只有枚举到的 macOS 用户应用本体可默认选择，所有声明型残留均默认不选，Windows 注册表命令与 Linux desktop/Flatpak 命令永不代执行。
- 开机启动：只修改 Linux/Windows 上明确支持且可回滚的用户级项目；macOS、系统级与未知来源项目保持只读。扫描、修改和撤销全局串行，避免跨项目并发放大本地校验或子进程调用。
- 垃圾清理：只扫描白名单缓存、日志和临时目录；跳过符号链接、近期文件、其他用户内容和系统目录。
- 局域网发现：只读取邻居表并发送有界 ICMP Echo；禁止端口扫描、服务识别、漏洞探测和公网扫描。

## 发布物约束

统一构建会拒绝：

- 根目录之外的写入或发布入口；
- 嵌套 `plugin.json`；
- `node_modules`、`src`、`tests`、source map 或符号链接；
- preload bundle、`eval`、Webpack 引导代码和无法解析的依赖；
- 超过或等于 15 MiB 的 dist 或 ZIP；
- ZIP entry 数量、CRC、解压长度或发布文件列表不一致。
- ZIP entry 使用绝对路径、`..`、反斜杠、NUL、重复名称，或 local/central 元数据不一致；每个解压内容还必须与当前 dist 的 SHA-256 完全相同，临时文件在原子 rename 前执行 fsync；
- 页面 CSP 包含 `unsafe-inline`、localhost、WebSocket 或其他开发来源。

模块 preload 保持未压缩、未混淆的 CommonJS 源码。前端依赖由各模块构建到静态资源，最终插件不携带开发依赖目录。
四个 workspace 只生成供根构建组装的内部 dist；构建会删除其中的 `plugin.json` 和旧的模块级 release，不支持单独部署，避免绕过根 preload 页面隔离与统一 CSP。
应用与启动项的用户可写元数据采用文件大小、字段长度和条目数量多层门禁；启动项通过文件句柄最多读取声明大小加 1 字节以检测读取期增长，扫描快照只保存哈希/stat 证据而不持有文件正文。
最终 runtime 仅信任精确的五个 `file:` 页面：dashboard 只获得套件路由，四个模块页只额外获得各自唯一业务桥；未知文件、HTTP(S)、查询参数或未列入白名单的片段页面不获得任何特权桥。为保证键盘跳转在刷新后仍可用，仅额外接受 dashboard 的 `#modules` 与垃圾清理页的 `#main`。

## 数据处理

系统管家不会统一持久化模块结果。模块可能读取完成当前任务所需的本地元数据，但不会通过 dashboard 上传。可选 DNS 名称解析等可能产生网络请求的行为由对应模块单独说明并默认关闭。

## 报告问题

请在提交安全问题时附带：操作系统及版本、ZTools 版本、触发 Feature、最小复现步骤，以及经过脱敏的错误信息。请勿附带用户名、完整本地路径、网络标识、Token 或其他敏感数据。
