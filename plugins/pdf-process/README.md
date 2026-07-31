# PDF Process

> ZTools PDF 处理插件 — 压缩、合并、拆分、水印、图片提取、格式转换

使用 **React + Vite + TypeScript** 构建的 ZTools 插件。

## 功能

| 功能 | 说明 |
|------|------|
| **基本压缩** | `pdfcpu optimize`，保留可选文字 |
| **强压缩** | 浏览器 pdf.js + DOM canvas 按 72–150 DPI 栅格化为 JPEG，preload 仅合成 PDF（避开 Electron 下 napi canvas 字体错误）；低质量自动灰度 |
| **合并** | 多 PDF 按序合并 |
| **拆分 / 提取** | **提取指定页**（如 `15-20` → 单个 PDF）或 **完整拆分**（剪刀 / 每隔 N 页） |
| **水印** | 文字水印 |
| **转图片** | 浏览器端 pdf.js 渲染导出 PNG/JPG |
| **转 Word / PPT / Excel** | 本地 Node 转换（文本抽取 / 扫描页图）；设置中可配置推荐网站（仅 https） |

## 快速开始

```bash
npm install
cd public/preload && npm install && cd ../..
npm run dev
```

### 构建

```bash
npm run build
```

产物在 `dist/`。请确保 `public/preload/node_modules` 已安装（含 `@napi-rs/canvas`、`docx` 等）后再构建/打包。

### 测试

```bash
npm test              # 前端 / jsdom
npm run test:convert  # preload（path-guard、convert、pdfcpu 静态检查等）
```

## 项目结构

```
.
├── public/
│   ├── logo.png                 # 插件图标
│   ├── plugin.json
│   └── preload/
│       ├── services.js          # window.services 门面
│       ├── path-guard.js        # 路径 / https 白名单
│       ├── lib/                 # 深模块实现
│       │   ├── pdfcpu-runner.js
│       │   ├── strong-compress.js
│       │   ├── create-pdf-from-images.js
│       │   ├── settings-store.js
│       │   ├── task-paths.js
│       │   └── watermark-layout.js
│       └── convert/             # 本地 PDF→Office
├── src/
│   ├── Compress/ Split/ Merge/ Watermark/ …
│   ├── components/PdfConvertPage.tsx   # Word/PPT/Excel 共用
│   └── utils/                   # strongCompress、splitPlan、pickFiles、safeUrl
├── package.json
└── README.md
```

