'use strict'

const { shell } = require('electron')
const { createEngine } = require('./core/engine.cjs')

const engine = createEngine({
  trashItem: (target) => shell.trashItem(target),
  revealItem: (target) => shell.showItemInFolder(target),
})

window.applicationUninstaller = Object.freeze({
  scanApps: () => engine.scanApps(),
  inspectApp: (appId) => engine.inspectApp(appId),
  executePlan: (request) => engine.executePlan(request),
  revealPath: (pathId) => engine.revealPath(pathId),
})
