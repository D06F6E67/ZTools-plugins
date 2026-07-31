'use strict'

const Module = require('node:module')
const path = require('node:path')

const [preloadPath, pageUrl] = process.argv.slice(2)
if (!path.isAbsolute(preloadPath) || typeof pageUrl !== 'string') process.exit(2)

const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (request === 'electron') {
    return {
      shell: {
        async trashItem() {},
        showItemInFolder() {},
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

global.window = {
  location: {
    href: pageUrl,
    assign(value) { this.href = value },
  },
  ztools: {
    onPluginEnter() {},
    copyText() {},
  },
}

require(preloadPath)

const bridgeNames = [
  'systemManagerSuite',
  'applicationUninstaller',
  'startupManager',
  'systemCleaner',
  'lanDiscovery',
]
process.stdout.write(JSON.stringify(bridgeNames.filter((name) => Object.hasOwn(window, name))))
