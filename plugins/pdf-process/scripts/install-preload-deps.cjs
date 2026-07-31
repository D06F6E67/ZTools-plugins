const { spawnSync } = require('node:child_process')
const path = require('node:path')

if (process.env.PDF_PROCESS_PRELOAD_INSTALLING === '1') {
  process.exit(0)
}

const preloadDir = path.resolve(__dirname, '..', 'public', 'preload')
const npmExecPath = process.env.npm_execpath
const env = {
  ...process.env,
  PDF_PROCESS_PRELOAD_INSTALLING: '1',
}

const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
const args = npmExecPath ? [npmExecPath, 'install'] : ['install']

const result = spawnSync(command, args, {
  cwd: preloadDir,
  env,
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
