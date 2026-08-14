# Changelog

本插件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-08-14

首个正式版本。一款在 ZTools 内快速检索 Maven 依赖、浏览历史版本并一键复制依赖声明的插件。

### 新增

- **三源聚合搜索**：同时查询 Maven Central（Solr）、阿里云 Maven 镜像、CodeRead 镜像，单源失败不影响其他
- **数据源 Tab**：全部（聚合去重）/ Central / 阿里云 / CodeRead 自由切换，记忆用户偏好（`dbStorage`）
- **分类筛选**：一级结果与二级版本面板均支持 全部 / Android / 非安卓 分类，判定基于 groupId / artifactId / 版本号是否含 `android`，偏好持久化
- **复制能力**：
  - `m` 复制 Maven `<dependency>` XML，`g` 复制 Gradle `implementation 'g:a:v'`
  - 阿里云结果自带版本，一级直接复制；Central / CodeRead 进入二级版本面板选版本后复制
  - CodeRead 二级版本页 HTML 解析（`/version?groupId=&artifactId=`）
  - 操作菜单（Enter/c/p）选择 POM / Android 格式
- **历史版本**：版本号 + 发布时间 + stable / snapshot / alpha / beta 标签 + LATEST 徽章，按时间倒序
- **代理配置**：设置弹窗（⚙），默认关闭，可配置后即时生效并持久化
- **搜索防抖**：停止输入 700ms 后触发
- **暗夜模式**：跟随 ZTools `isDarkColors()`
- **键盘导航**：↑↓ 移动、←→ 切源、全局复制快捷键、帮助浮层（Cmd/Ctrl+K）
- **错误处理**：结构化 `ServiceError`（URL/状态/耗时/响应体），429 重试，超时包装，可展开错误详情并一键复制
- **排序**：`com|org|dev|cn` 开头的 groupId 优先置顶

### 变更

- 移除模板示例功能（hello / read / write）
- 移除 GraphQL 降级（`central.sonatype.com/graphql` 不可达）
- 移除坐标 / JAR URL 复制及对应快捷键
- 插件打包：`npm run build` 产出 `dist.zip`（扁平 `preload.js` 结构，对齐 ztools-jenkins）

### 修复

- 修复 ZTools 沙箱 preload 中 `require` 不可用导致空白页
- 修复 `setSubInput` 回调参数实际为 `{ text }` 对象导致的崩溃
- 修复空态在搜索完成前误显示"没找到相关包"
- 修复阿里云 `unknown` 版本、`packaging != pom`、`#` groupId 数据问题
- 修复 CodeRead 仅支持 HTTP（无 TLS）
- 修复搜索框聚焦时复制快捷键泄漏到输入框

### 技术栈

Vue 3 · Vite · TypeScript · Vitest · @vue/test-utils · Playwright
