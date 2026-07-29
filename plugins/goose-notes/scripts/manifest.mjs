export const buildMainManifest = (upstreamManifest, meta) => ({
  name: meta.main.name,
  title: meta.main.title,
  ...upstreamManifest,
  ...meta.main,
  version: meta.version,
  homepage: meta.homepage,
  main: 'index.html',
  preload: 'preload.js'
})

export const buildQuicknoteManifest = (upstreamManifest, meta) => {
  const manifest = {
    name: meta.quicknote.name,
    title: meta.quicknote.title,
    ...upstreamManifest,
    ...meta.quicknote,
    version: meta.version,
    homepage: meta.homepage,
    preload: 'preload-quicknote.js'
  }
  delete manifest.main
  return manifest
}
