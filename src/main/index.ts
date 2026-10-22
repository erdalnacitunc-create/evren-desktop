import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  nativeTheme,
  session,
  Tray,
  nativeImage
} from 'electron'
import { join } from 'path'
import { appIconPath } from './appIcon'
import { abortAllChats } from './chat'
import { cleanupInspectCache } from './extensions'
import { registerIpcHandlers } from './ipc'
import { disconnectAllMcp } from './mcp/manager'
import { unloadAllPlugins } from './plugins/manager'
import { runSelfTest } from './selftest'
import { startAcp } from './acp'
import { applyHeadlessSettings, stopHeadlessServer } from './headless'
import { startScheduler, stopScheduler } from './scheduler'
import { stopTerminal } from './terminal'
import {
  initUpdater,
  stopUpdater
} from './updater'
import { openExternalSafe } from './safeOpen'
import { initSubagentTaskStore, resumeInterruptedSubagentTasks } from './agent/taskManager'
import { getSettings } from './settings'
import { loadWindowState, trackWindowState } from './windowState'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
const acpMode = process.argv.includes('--acp') || process.env['EVREN_ACP'] === '1'

if (acpMode) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
}

const dataDir =
  process.env['EVREN_DATA_DIR'] ??
  (process.env['EVREN_SELFTEST'] === '1' ? process.env['EVREN_SELFTEST_DATA'] : undefined)
if (dataDir) {
  app.setPath('userData', dataDir)
} else if (app.isPackaged) {
  // Beta paketi, geliştirme profiliyle aynı kullanıcı verisini kullanmaz.
  app.setPath('userData', join(app.getPath('appData'), 'EVREN Desktop Beta'))
}

const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' ws: http://localhost:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none';"
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none';"

function applyContentSecurityPolicy(): void {
  const csp = isDev ? DEV_CSP : PROD_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

function applyPermissionPolicy(): void {
  // Pano yazma + mikrofon; kamera/video reddedilir.
  const allowed = new Set(['clipboard-sanitized-write', 'media'])
  const audioOnly = (details: unknown): boolean => {
    const mediaTypes = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes ?? []
    return mediaTypes.length === 0 || (mediaTypes.includes('audio') && !mediaTypes.includes('video'))
  }
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission === 'media') {
        callback(audioOnly(details))
        return
      }
      callback(allowed.has(permission))
    }
  )
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, _origin, details) => {
      if (permission === 'media') return audioOnly(details)
      return allowed.has(permission)
    }
  )
  session.defaultSession.setDevicePermissionHandler(() => false)
}

function buildContextMenuTemplate(
  win: BrowserWindow,
  params: Electron.ContextMenuParams
): Electron.MenuItemConstructorOptions[] {
  const template: Electron.MenuItemConstructorOptions[] = []

  if (params.isEditable) {
    template.push(
      { label: 'Geri Al', role: 'undo', enabled: params.editFlags.canUndo },
      { label: 'Yinele', role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Kes', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Kopyala', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Yapıştır', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'Tümünü Seç', role: 'selectAll', enabled: params.editFlags.canSelectAll }
    )
  } else {
    if (params.selectionText.trim()) {
      template.push({ label: 'Kopyala', role: 'copy' })
    }
    if (params.linkURL) {
      template.push(
        {
          label: 'Bağlantıyı aç',
          click: () => {
            void openExternalSafe(params.linkURL)
          }
        },
        {
          label: 'Bağlantı adresini kopyala',
          click: () => clipboard.writeText(params.linkURL)
        }
      )
    }
    if (params.mediaType === 'image' && params.srcURL) {
      template.push(
        {
          label: 'Resmi kopyala',
          click: () => win.webContents.copyImageAt(params.x, params.y)
        },
        {
          label: 'Resim adresini kopyala',
          click: () => clipboard.writeText(params.srcURL)
        }
      )
    }
    if (template.length > 0) template.push({ type: 'separator' })
    template.push({ label: 'Tümünü Seç', role: 'selectAll' })
  }

  if (isDev) {
    template.push(
      { type: 'separator' },
      { label: 'İncele', click: () => win.webContents.inspectElement(params.x, params.y) }
    )
  }

  return template
}

function attachContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    Menu.buildFromTemplate(buildContextMenuTemplate(win, params)).popup({ window: win })
  })
}

let tray: Tray | null = null

function showMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function setupTray(): void {
  if (tray) return
  const image = nativeImage.createFromPath(appIconPath())
  if (image.isEmpty()) return
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('EVREN Desktop')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Göster', click: showMainWindow },
      {
        label: 'Gizle',
        click: () => BrowserWindow.getAllWindows()[0]?.hide()
      },
      { type: 'separator' },
      { label: 'Çıkış', click: () => app.quit() }
    ])
  )
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

async function createWindow(): Promise<void> {
  const state = await loadWindowState()
  const isMac = process.platform === 'darwin'
  const iconPath = appIconPath()

  const mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'EVREN Desktop',
    icon: iconPath,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    backgroundColor: '#0a0f1c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })

  const notifyMaximized = (): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', notifyMaximized)
  mainWindow.on('unmaximize', notifyMaximized)

  if (state.maximized) mainWindow.maximize()
  trackWindowState(mainWindow)
  attachContextMenu(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // CI / duman testi: arayuz render olduktan sonra icerigi yazdir ve cik
  if (process.env['EVREN_SMOKE'] === '1') {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        const clickText = process.env['EVREN_SMOKE_CLICK']
        const targets = clickText
          ? clickText
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : []
        const script =
          targets.length > 0
            ? `(async () => {
                const targets = ${JSON.stringify(targets)};
                for (const target of targets) {
                  const candidates = [
                    ...document.querySelectorAll('button'),
                    ...document.querySelectorAll('[role="button"]'),
                    ...document.querySelectorAll('a')
                  ];
                  let element = candidates.find(
                    (node) => node.textContent && node.textContent.includes(target)
                  );
                  if (!element) {
                    element = [...document.querySelectorAll('*')].find(
                      (node) =>
                        node.children.length === 0 &&
                        node.textContent &&
                        node.textContent.includes(target)
                    );
                  }
                  if (element) element.click();
                  await new Promise((resolve) => setTimeout(resolve, 650));
                }
                return document.body.innerText;
              })()`
            : 'document.body.innerText'

        void mainWindow.webContents
          .executeJavaScript(script)
          .then((text: string) => {
            const compact = String(text).replace(/\s+/g, ' ').trim().slice(0, 1100)
            console.log(`[smoke] ${compact}`)

            if (process.env['EVREN_SMOKE_CONTEXTMENU'] === '1') {
              const sample = buildContextMenuTemplate(mainWindow, {
                isEditable: true,
                selectionText: '',
                linkURL: '',
                mediaType: 'none',
                srcURL: '',
                x: 0,
                y: 0,
                editFlags: {
                  canUndo: true,
                  canRedo: true,
                  canCut: true,
                  canCopy: true,
                  canPaste: true,
                  canSelectAll: true,
                  canDelete: true
                }
              } as unknown as Electron.ContextMenuParams)
              console.log(
                `[smoke] contextmenu=${sample
                  .map((item) => item.label ?? item.role ?? item.type)
                  .join(',')}`
              )
            }
          })
          .catch((error: unknown) => {
            console.log(`[smoke] error=${error instanceof Error ? error.message : String(error)}`)
          })
          .finally(() => app.quit())
      }, 2500)
    })
  }

  // Harici baglantilar sistem tarayicisinda acilir; yalnizca http(s).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafe(url)
    return { action: 'deny' }
  })

  // Renderer'in uygulama penceresini baska bir adrese yonlendirmesini engelle.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  if (isDev) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.evren.desktop')
  }

  if (process.env['EVREN_SELFTEST'] === '1') {
    await runSelfTest()
    return
  }

  if (acpMode) {
    startAcp()
    return
  }

  applyContentSecurityPolicy()
  applyPermissionPolicy()
  registerIpcHandlers()
  Menu.setApplicationMenu(null)
  await initSubagentTaskStore()
  const settings = await getSettings()
  if (settings.subagents?.autoResume) {
    void resumeInterruptedSubagentTasks()
  }
  await startScheduler()
  await applyHeadlessSettings()
  await createWindow()
  initUpdater()
  setupTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (acpMode) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopScheduler()
  stopTerminal()
  stopUpdater()
  void stopHeadlessServer()
  tray?.destroy()
  tray = null
  abortAllChats()
  void disconnectAllMcp()
  void unloadAllPlugins()
  void cleanupInspectCache()
})
