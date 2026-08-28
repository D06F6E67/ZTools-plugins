console.log('preload.js loaded!');
// ZTools preload —— 独立数据，不读 Unity Hub
// ZTools 要求定义与 plugin.json feature code 对应的 exports，否则提示未配置
const ztools = window.ztools || window.utools || {};
window.exports = {
  'unity-launcher': {
    mode: 'none',
    args: {
      enter() {
        if (ztools.setExpendHeight) ztools.setExpendHeight(620);
        if (ztools.showMainWindow) ztools.showMainWindow();
      },
      leave() {}
    }
  }
};
window.services = {
  // ---------- ZTools 数据库 ----------
  dbGet(key) { return ztools.dbStorage ? ztools.dbStorage.getItem(key) : null; },
  dbSet(key, val) { return ztools.dbStorage ? ztools.dbStorage.setItem(key, val) : null; },

  // ---------- 文件/目录选择（支持单个/批量扫描） ----------
  pickFolder() {
    if (!ztools.showOpenDialog) return null;
    const r = ztools.showOpenDialog({
      title: '选择 Unity 项目文件夹（或选择其父文件夹以批量扫描项目）',
      properties: ['openDirectory'],
      filters: [{ name: 'Unity 项目', extensions: ['*'] }]
    });
    if (!r || !r.length) return null;
    const selectedPath = r[0];
    
    // 1. 检查选择 of the directory itself is a Unity project
    const selfProj = validateProject(selectedPath);
    if (selfProj.isUnityProject) {
      return [selfProj];
    }
    
    // 2. If it is not a project itself, scan its first-level subdirectories
    const subprojects = [];
    const fs = require('fs');
    const path = require('path');
    try {
      const files = fs.readdirSync(selectedPath, { withFileTypes: true });
      for (const file of files) {
        if (file.isDirectory()) {
          const subPath = path.join(selectedPath, file.name);
          const subProj = validateProject(subPath);
          if (subProj.isUnityProject) {
            subprojects.push(subProj);
          }
        }
      }
    } catch (e) {}
    
    return subprojects;
  },
  pickExe() {
    if (!ztools.showOpenDialog) return null;
    const r = ztools.showOpenDialog({
      title: '选择包含 Unity 编辑器的文件夹（将自动递归扫描 Unity.exe）',
      properties: ['openDirectory'],
      filters: [{ name: 'Unity Editor Folder', extensions: ['*'] }]
    });
    if (!r || !r.length) return null;
    const selectedPath = r[0];
    
    const path = require('path');
    const exes = findUnityExes(selectedPath);
    
    return exes.map(exe => {
      const m = exe.match(/(\d{4}\.\d+\.\d+[a-z]\d+)/i);
      return {
        path: exe,
        version: m ? m[1] : path.basename(path.dirname(path.dirname(exe)))
      };
    });
  },

  // ---------- 启动 ----------
  launch(editorPath, projectPath) {
    const { spawn } = require('child_process');
    const child = spawn(editorPath, ['-projectPath', projectPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  },

  createProject(editorPath, projectPath) {
    const { spawn } = require('child_process');
    const child = spawn(editorPath, ['-createProject', projectPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return true;
  },

  openInExplorer(p) { if (ztools.shellOpenPath) ztools.shellOpenPath(p); },

  pickDirectory() {
    if (!ztools.showOpenDialog) return null;
    const r = ztools.showOpenDialog({
      title: '选择新项目的存放目录',
      properties: ['openDirectory']
    });
    return r && r.length ? r[0] : null;
  },

  createNewProject(editorPath, parentPath, name) {
    const fs = require('fs');
    const path = require('path');
    const targetPath = path.join(parentPath, name);
    if (fs.existsSync(targetPath)) {
      throw new Error('该存放目录下已存在同名文件夹！');
    }
    const { spawn } = require('child_process');
    const child = spawn(editorPath, ['-createProject', targetPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return targetPath;
  },

  // 校验是否像 Unity 项目
  validateFolder(p) { return validateProject(p); },

  // 删除本地项目文件夹（同步）
  deleteFolder(folderPath) {
    const fs = require('fs');
    if (!fs.existsSync(folderPath)) return false;
    try {
      if (fs.rmSync) {
        fs.rmSync(folderPath, { recursive: true, force: true });
      } else {
        fs.rmdirSync(folderPath, { recursive: true });
      }
      return true;
    } catch (e) {
      console.error('deleteFolder failed:', e);
      throw e;
    }
  },

  // 异步删除本地项目文件夹（不卡顿 UI 渲染线程）
  deleteFolderAsync(folderPath) {
    const fs = require('fs');
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(folderPath)) {
        return resolve(false);
      }
      if (fs.rm) {
        fs.rm(folderPath, { recursive: true, force: true }, (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      } else if (fs.rmdir) {
        fs.rmdir(folderPath, { recursive: true }, (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      } else {
        try {
          fs.rmSync(folderPath, { recursive: true, force: true });
          resolve(true);
        } catch (e) {
          reject(e);
        }
      }
    });
  }
};

function findUnityExes(dir, depth = 0) {
  if (depth > 3) return []; // 限制深度为 3 层，避免在大目录下卡死
  const fs = require('fs');
  const path = require('path');
  let results = [];
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        const nameLower = file.name.toLowerCase();
        // 跳过显然不相关的或可能极大的文件夹，以保证扫描效率
        if (file.name.startsWith('.') || nameLower === 'node_modules' || nameLower === 'library' || nameLower === 'assets' || nameLower === 'projectsettings') {
          continue;
        }
        results = results.concat(findUnityExes(fullPath, depth + 1));
      } else if (file.isFile() && file.name.toLowerCase() === 'unity.exe') {
        results.push(fullPath);
      }
    }
  } catch (e) {}
  return results;
}

function validateProject(dir) {
  const fs = require('fs');
  const path = require('path');
  let hasAssets = fs.existsSync(path.join(dir, 'Assets'));
  let hasSettings = fs.existsSync(path.join(dir, 'ProjectSettings'));
  let version = null;
  const pv = path.join(dir, 'ProjectSettings', 'ProjectVersion.txt');
  if (fs.existsSync(pv)) {
    try {
      version = (fs.readFileSync(pv, 'utf8').match(/m_EditorVersion:\s*(\S+)/) || [])[1] || null;
    } catch (e) {}
  }
  return { path: dir, isUnityProject: hasAssets && hasSettings, detectedVersion: version };
}
