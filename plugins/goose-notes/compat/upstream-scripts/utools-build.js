import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const rootDir = path.resolve('.');

if (!fs.existsSync(distDir)) {
  console.error('dist 目录不存在');
  process.exit(1);
}

const removeMapFiles = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeMapFiles(full);
    } else if (entry.name.endsWith('.map')) {
      fs.unlinkSync(full);
    }
  }
};

try {
  const preloadSrc = path.join(rootDir, 'preload/preload.cjs');
  if (fs.existsSync(preloadSrc)) {
    fs.copyFileSync(preloadSrc, path.join(distDir, 'preload.js'));
  }

  const preloadHelperSrc = path.join(rootDir, 'preload/mcp-tools.cjs');
  if (fs.existsSync(preloadHelperSrc)) {
    fs.copyFileSync(preloadHelperSrc, path.join(distDir, 'mcp-tools.cjs'));
  }

  const webFetchHelperSrc = path.join(rootDir, 'preload/web-fetch.cjs');
  if (fs.existsSync(webFetchHelperSrc)) {
    fs.copyFileSync(webFetchHelperSrc, path.join(distDir, 'web-fetch.cjs'));
  }

  fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

  const logoSrc = path.join(rootDir, 'public/logo.png');
  if (fs.existsSync(logoSrc)) {
    fs.copyFileSync(logoSrc, path.join(distDir, 'logo.png'));
  }

  const pluginConfigPath = path.join(rootDir, 'plugin.json');
  if (fs.existsSync(pluginConfigPath)) {
    const pluginConfig = JSON.parse(fs.readFileSync(pluginConfigPath, 'utf-8'));
    pluginConfig.main = 'index.html';
    pluginConfig.preload = 'preload.js';
    fs.writeFileSync(path.join(distDir, 'plugin.json'), JSON.stringify(pluginConfig, null, 2));
  } else {
    console.error('未找到 plugin.json');
    process.exit(1);
  }

  if (process.env.GOOSE_DEBUG === '1') {
    console.log('[utools-build] GOOSE_DEBUG=1：保留 sourcemap (.map) 文件');
  } else {
    removeMapFiles(distDir);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}

const distQuicknoteDir = path.resolve('dist-quicknote');

try {
  if (!fs.existsSync(distQuicknoteDir)) {
    console.error('dist-quicknote 目录不存在——请先执行 quicknote 构建：GOOSE_BUILD_TARGET=quicknote vite build');
    process.exit(1);
  }

  const preloadQnSrc = path.join(rootDir, 'preload/preload-quicknote.cjs');
  if (fs.existsSync(preloadQnSrc)) {
    fs.copyFileSync(preloadQnSrc, path.join(distQuicknoteDir, 'preload-quicknote.js'));
  } else {
    console.error('未找到 preload/preload-quicknote.cjs');
    process.exit(1);
  }

  const qnPluginSrc = path.join(rootDir, 'quicknote-plugin.json');
  if (fs.existsSync(qnPluginSrc)) {
    const qnPluginConfig = JSON.parse(fs.readFileSync(qnPluginSrc, 'utf-8'));
    qnPluginConfig.preload = 'preload-quicknote.js';
    fs.writeFileSync(path.join(distQuicknoteDir, 'plugin.json'), JSON.stringify(qnPluginConfig, null, 2));
  } else {
    console.error('未找到 quicknote-plugin.json');
    process.exit(1);
  }

  const qnLogo = path.join(distQuicknoteDir, 'logo.png');
  if (!fs.existsSync(qnLogo)) {
    const publicLogo = path.join(rootDir, 'public/logo.png');
    if (fs.existsSync(publicLogo)) {
      fs.copyFileSync(publicLogo, qnLogo);
    }
  }

  fs.writeFileSync(path.join(distQuicknoteDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

  if (process.env.GOOSE_DEBUG === '1') {
    console.log('[utools-build] GOOSE_DEBUG=1：dist-quicknote 保留 sourcemap (.map) 文件');
  } else {
    removeMapFiles(distQuicknoteDir);
  }

  console.log('[utools-build] dist-quicknote/ 产出完成');
} catch (e) {
  console.error(e);
  process.exit(1);
}
