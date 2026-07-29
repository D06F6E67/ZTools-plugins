# text-case-converter

ZTools 插件：选中文本或剪贴板中的英文内容，一键智能/手动转换大小写。

## 功能


| 功能    | 触发关键字                    | 选中有效文本时       |
| ----- | ------------------------ | ------------- |
| 智能大小写 | `大小写` / `智能大小写` / `case` | 超级面板显示「智能大小写」 |
| 转大写   | `转大写` / `uppercase`      | 「转大写」         |
| 转小写   | `转小写` / `lowercase`      | 「转小写」         |
| 大小写反转 | `大小写反转` / `invert case`  | 「大小写反转」       |


**智能规则**（只统计英文字母 `[A-Za-z]`）：大写字母数多于小写则整段转小写，否则（含相等）转大写。

**输出**：

- 选中文本触发 → 转换后粘贴回原选区，系统通知后退出
- 关键字触发 → 读取剪贴板，写回剪贴板并通知后退出
- 无英文字母 → 提示「未检测到有效英文字母」，直接退出

## 开发

```bash
pnpm install
pnpm run build   # tsc → 生成 public/*.png → 组装 dist/
pnpm run icons   # 仅生成 public/*.png（不提交，已 gitignore）
pnpm run dev     # tsc -w（改完后需再 pnpm run build）
```

本地调试请加载 `dist/`。图标由 `scripts/svg-to-png.cjs` 在构建时生成，仓库不提交 PNG；示例字母见脚本顶部 `SAMPLE_LETTER`。

## 构建产物（CI zip 根）

```
dist/
├── plugin.json
├── preload.js
├── case-convert.js
└── public/
    ├── logo.png
    ├── smart.png
    ├── upper.png
    ├── lower.png
    └── invert.png
```



## 相关文档

- [第一个插件](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html)
- [preload-js](https://ztoolscenter.github.io/ZTools-doc/preload-js.html)
- [plugin.json 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html)
- [插件 API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)

