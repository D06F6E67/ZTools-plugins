'use strict'

const path = require('node:path')
const { installSuiteRouter } = require('./router.cjs')

const SUITE_ROOT = path.resolve(__dirname, '..')

function loadFeatureService(featureCode, runtimeRequire = require) {
  switch (featureCode) {
    case 'application-uninstaller':
      runtimeRequire('../modules/application-uninstaller/preload/services.cjs')
      return true
    case 'startup-manager':
      runtimeRequire('../modules/startup-manager/preload/services.cjs')
      return true
    case 'system-cleaner':
      runtimeRequire('../modules/system-cleaner/preload/services.cjs')
      return true
    case 'lan-device-discovery':
      runtimeRequire('../modules/lan-device-discovery/preload/services.cjs')
      return true
    default:
      return false
  }
}

function bootstrap(hostWindow, options = {}) {
  const suiteRoot = options.suiteRoot || SUITE_ROOT
  const installed = installSuiteRouter(hostWindow, suiteRoot, options.platform || process.platform)
  if (!installed) return Object.freeze({ page: null, router: null, serviceLoaded: false })
  const serviceLoaded = installed.page.kind === 'module'
    ? loadFeatureService(installed.page.featureCode, options.runtimeRequire || require)
    : false
  return Object.freeze({ page: installed.page, router: installed.router, serviceLoaded })
}

if (typeof window !== 'undefined') bootstrap(window)

module.exports = Object.freeze({ SUITE_ROOT, bootstrap, loadFeatureService })
