# 鹅的笔记 ZTools 适配

本目录从 [eachann1024/goose-notes](https://github.com/eachann1024/goose-notes) 的固定提交生成。
`upstream/` 保持上游源码原样，ZTools 适配仅发生在构建产物阶段。

## 本地构建

```bash
./build-plugin.sh
```

主插件产物位于 `dist/`。同一构建还会生成尚未发布的速记候选产物
`dist-quicknote-ztools/`，用于后续独立窗口真机验证。

## 同步上游

```bash
node scripts/sync-upstream.mjs --ref main
```

同步脚本会更新源码快照、`upstream.lock.json` 和根目录 `plugin.json`，并自动递增
ZTools 适配版本的 patch 位。发布构建始终使用已提交的固定源码，不会在线拉取上游分支。
