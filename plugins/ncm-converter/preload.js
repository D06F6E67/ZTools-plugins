// ZTools 插件 preload：通用音频转 MP3（含 NCM 解密）
// 运行在 Node 上下文，可直接使用 require / fs / path / child_process。
// NCM 走纯 JS 解密；其他格式优先调用系统 ffmpeg 转码（绝对路径探测），避免触发 ZTools 的 FFmpeg 下载弹窗。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { parseNcm } = require('./ncmdump.cjs');

// 立即隐藏主窗口：ZTools 启动任何插件都会先 show 主窗口（AppsAPI.launch 无 headless 豁免），
// preload 一加载就把它藏掉，比 enter() 更早，尽量压缩「闪屏」空隙。
(function silentHide() {
  try {
    if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.hideMainWindow === 'function') {
      // 实验版 v4.2：false = 不恢复 explorer 焦点，排查「任务栏/资源管理器闪烁」是否是闪屏来源
      window.ztools.hideMainWindow(false);
    }
  } catch (e) {}
})();

// 清理文件名中的非法字符（Windows）
function sanitize(name) {
  return (name || 'output')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'output';
}

// 把 parseNcm 返回的 audio（Uint8Array / Buffer / 类数组对象）统一转成 Buffer
function toBuffer(x) {
  if (!x) return Buffer.alloc(0);
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (Array.isArray(x)) return Buffer.from(x);
  if (typeof x === 'object') {
    const len = Object.keys(x).length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = x[i];
    return Buffer.from(u8);
  }
  return Buffer.from(x);
}

// 超强兼容：把 action 里各种可能形态的文件描述提取为纯路径字符串数组。
function collectPaths(action) {
  let payload = action;
  if (action && typeof action === 'object') {
    if ('payload' in action) payload = action.payload;
    else if ('files' in action) payload = action.files;
  }
  const list = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const item of list) {
    if (item == null) continue;
    if (typeof item === 'string') { out.push(item); continue; }
    if (typeof item === 'object') {
      const p =
        item.path || item.filePath || item.realPath ||
        (item.data && (item.data.path || item.data.filePath)) ||
        item.name;
      if (typeof p === 'string') out.push(p);
    }
  }
  return out;
}

// 调试用：把结构压缩成可读摘要
function summarize(v) {
  try {
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 400);
    return String(v);
  } catch (e) {
    return '[unstringifiable ' + (v && v.constructor && v.constructor.name) + ']';
  }
}

// 本地测试 / 非 ZTools 环境 fallback：探测系统 ffmpeg
let _ffmpeg;
function findFfmpeg() {
  if (_ffmpeg !== undefined) return _ffmpeg;
  const cands = [
    process.env.FFMPEG_PATH,
    'ffmpeg',
    'C:/Program Files/ffmpeg-2022-11-03/bin/ffmpeg.exe',
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files (x86)/ffmpeg/bin/ffmpeg.exe',
    'C:/ffmpeg/bin/ffmpeg.exe'
  ].filter(Boolean);
  for (const c of cands) {
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore', windowsHide: true });
      _ffmpeg = c;
      return c;
    } catch (e) {}
  }
  _ffmpeg = null;
  return null;
}

// 运行 ffmpeg：优先使用系统已安装的 ffmpeg（绝对路径探测），彻底绕开 ZTools 的
// FFmpeg 下载弹窗（实测 ZTools 下载节点在你网络下全部不可达）。仅当系统无 ffmpeg 时，
// 才退回 ZTools 内置 runFFmpeg（会弹集成下载窗，让用户自行决定）。
function runFfmpeg(args) {
  const ff = findFfmpeg();
  if (ff) {
    return new Promise((resolve, reject) => {
      const cp = spawn(ff, args, { windowsHide: true });
      let err = '';
      if (cp.stderr) cp.stderr.on('data', d => { err += d.toString(); });
      cp.on('error', e => reject(e));
      cp.on('close', code => {
        if (code === 0) return resolve();
        const tail = err.split('\n')
          .filter(l => /error|invalid|failed|no such file|unable/i.test(l))
          .slice(-3).join('\n') || ('ffmpeg 退出码 ' + code);
        reject(new Error(tail));
      });
    });
  }
  // 本地没有 ffmpeg，再退回 ZTools 内置（会弹集成下载窗）
  if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.runFFmpeg === 'function') {
    return window.ztools.runFFmpeg(args);
  }
  return Promise.reject(new Error('未检测到 ffmpeg。请安装 ffmpeg 并加入 PATH，或设置环境变量 FFMPEG_PATH。'));
}

// 生成不冲突的输出路径
function uniquePath(dir, name) {
  let p = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(p)) {
    const ext = path.extname(name);
    const base = name.slice(0, -ext.length);
    p = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return p;
}

// 构造输出文件名（NCM 优先用元数据，其他用原文件名）
function buildName(filePath, metadata) {
  const base = path.basename(filePath, path.extname(filePath));
  const meta = metadata || {};
  if (meta.musicName) {
    let artist = '';
    if (Array.isArray(meta.artist)) {
      artist = meta.artist.map(a => (Array.isArray(a) ? a[0] : a)).filter(Boolean).join(', ');
    } else if (typeof meta.artist === 'string') {
      artist = meta.artist;
    }
    return sanitize((artist ? artist + ' - ' : '') + meta.musicName);
  }
  return sanitize(base);
}

// NCM 解密并输出为无封面 MP3
async function ncmToMp3(filePath) {
  const buf = fs.readFileSync(filePath);
  const { format, metadata, audio } = parseNcm(buf);

  const tmp = path.join(os.tmpdir(), `ncm_dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${format}`);
  fs.writeFileSync(tmp, toBuffer(audio));

  const outName = `${buildName(filePath, metadata)}.mp3`;
  const outPath = uniquePath(path.dirname(filePath), outName);

  // NCM 源若是 mp3，仅去封面不重编码；flac 等则编码为 mp3
  const args = format === 'mp3'
    ? ['-y', '-i', tmp, '-vn', '-c:a', 'copy', outPath]
    : ['-y', '-i', tmp, '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', outPath];

  try {
    await runFfmpeg(args);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
  return outPath;
}

// 通用音频转 MP3（无封面）
async function convertFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  if (ext === 'ncm') return ncmToMp3(filePath);

  const outName = `${buildName(filePath)}.mp3`;
  const outPath = uniquePath(path.dirname(filePath), outName);
  await runFfmpeg(['-y', '-i', filePath, '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', outPath]);
  return outPath;
}

// 统一的入口处理
async function handle(action) {
  try {
    // 静默：ZTools 启动任何插件都会先弹主窗口（AppsAPI.launch → mainWindow.show()），
    // headless 插件必须主动 hideMainWindow 才能让用户无感；outPlugin 退出插件视图。
    if (typeof window !== 'undefined' && window.ztools) {
      if (typeof window.ztools.hideMainWindow === 'function') {
        try { window.ztools.hideMainWindow(false); } catch (e) {}
      }
      if (typeof window.ztools.outPlugin === 'function') {
        window.ztools.outPlugin().catch(() => {});
      }
    }

    let files = collectPaths(action);

    // 没有拿到文件：弹文件选择器
    if (files.length === 0) {
      let picked = null;
      if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.showOpenDialog === 'function') {
        picked = window.ztools.showOpenDialog({
          title: '选择音频文件',
          properties: ['openFile', 'multiSelections'],
          filters: [{
            name: 'Audio',
            extensions: ['ncm', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus', 'mp3', 'ape', 'caf', 'aiff', 'amr']
          }]
        });
        if (picked && !Array.isArray(picked) && Array.isArray(picked.filePaths)) picked = picked.filePaths;
      }
      if (Array.isArray(picked) && picked.length) files = picked;
    }

    if (!files.length) {
      if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.showNotification === 'function') {
        window.ztools.showNotification('未获取到音频文件。\naction:\n' + summarize(action));
      }
      return;
    }

    const lines = [];
    for (const f of files) {
      const fp = typeof f === 'string' ? f : (f && f.path) || '';
      if (!fp) {
        lines.push('跳过（无法解析路径）');
        continue;
      }
      try {
        const out = await convertFile(fp);
        lines.push('✓ ' + path.basename(out));
      } catch (e) {
        lines.push('✗ ' + path.basename(fp) + ': ' + (e && e.message ? e.message : e));
      }
    }

    if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.showNotification === 'function') {
      window.ztools.showNotification('转 MP3 完成\n' + lines.join('\n'));
    }
  } catch (e) {
    if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.showNotification === 'function') {
      window.ztools.showNotification('转 MP3 失败: ' + (e && e.message ? e.message : e));
    }
  }
}

window.exports = {
  convert: { mode: 'none', args: { enter: handle } },
  'convert-pick': { mode: 'none', args: { enter: handle } }
};

// 本地测试导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { collectPaths, toBuffer, convertFile, findFfmpeg, runFfmpeg };
}
