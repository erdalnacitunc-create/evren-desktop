import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { InstalledExtension } from '../../shared/types'
import { createLogger } from '../logger'

const log = createLogger('extensions/store')

let cache: InstalledExtension[] | null = null
let writeChain: Promise<void> = Promise.resolve()

function registryFile(): string {
  return join(app.getPath('userData'), 'extensions.json')
}

export function extensionsRoot(): string {
  return join(app.getPath('userData'), 'extensions')
}

async function load(): Promise<InstalledExtension[]> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(registryFile(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    cache = Array.isArray(parsed) ? (parsed as InstalledExtension[]) : []
  } catch {
    cache = []
  }
  return cache
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(cache ?? [], null, 2)
  const target = registryFile()
  const temp = `${target}.tmp`
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await fs.writeFile(temp, snapshot, 'utf8')
      await fs.rename(temp, target)
    })
    .catch((error) => {
      log.error('Uzantı kayıt defteri yazılamadı:', error)
    })
  return writeChain
}

export async function listExtensions(): Promise<InstalledExtension[]> {
  const items = await load()
  return [...items].sort((a, b) => b.installedAt - a.installedAt)
}

export async function getExtension(id: string): Promise<InstalledExtension | null> {
  const items = await load()
  return items.find((item) => item.id === id) ?? null
}

export async function upsertExtension(extension: InstalledExtension): Promise<void> {
  const items = await load()
  const index = items.findIndex((item) => item.id === extension.id)
  if (index >= 0) {
    items[index] = extension
  } else {
    items.push(extension)
  }
  await persist()
}

export async function removeExtension(id: string): Promise<boolean> {
  const items = await load()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return false
  const [removed] = items.splice(index, 1)
  await persist()

  if (removed?.localPath) {
    try {
      await fs.rm(join(extensionsRoot(), removed.localPath), { recursive: true, force: true })
    } catch {
      // dosya zaten yok
    }
  }
  return true
}

export async function setExtensionEnabled(id: string, enabled: boolean): Promise<boolean> {
  const items = await load()
  const extension = items.find((item) => item.id === id)
  if (!extension) return false
  extension.enabled = enabled
  extension.updatedAt = Date.now()
  await persist()
  return true
}

export async function updateExtensionConfig(
  id: string,
  config: InstalledExtension['config']
): Promise<InstalledExtension | null> {
  const items = await load()
  const extension = items.find((item) => item.id === id)
  if (!extension) return null
  extension.config = config
  extension.updatedAt = Date.now()
  await persist()
  return extension
}
