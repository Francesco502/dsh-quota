import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { existsSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'

/**
 * Cross-platform path resolver for user application data directories.
 * Strictly avoids any hardcoded machine paths.
 */
export function getAppStoragePaths(appName: string, relativeFile: string): string[] {
  const home = homedir()
  const paths: string[] = []
  const currentPlatform = platform()

  if (currentPlatform === 'win32') {
    if (process.env.APPDATA) {
      paths.push(join(process.env.APPDATA, appName, relativeFile))
    }
    if (process.env.LOCALAPPDATA) {
      paths.push(join(process.env.LOCALAPPDATA, appName, relativeFile))
    }
    if (process.env.USERPROFILE) {
      paths.push(join(process.env.USERPROFILE, 'AppData', 'Roaming', appName, relativeFile))
      paths.push(join(process.env.USERPROFILE, 'AppData', 'Local', appName, relativeFile))
    }
  } else if (currentPlatform === 'darwin') {
    paths.push(join(home, 'Library', 'Application Support', appName, relativeFile))
  } else {
    // Linux / Unix / WSL
    if (process.env.XDG_CONFIG_HOME) {
      paths.push(join(process.env.XDG_CONFIG_HOME, appName, relativeFile))
    }
    paths.push(join(home, '.config', appName, relativeFile))

    // If running in WSL, check mounted Windows user directories dynamically
    if (process.env.WSL_DISTRO_NAME || existsSync('/mnt/c/Users')) {
      const wslUsersDir = '/mnt/c/Users'
      try {
        // Look for candidate username from environment
        const candidateUsers = [process.env.USER, process.env.USERNAME, process.env.LOGNAME].filter(Boolean) as string[]
        for (const u of candidateUsers) {
          paths.push(join(wslUsersDir, u, 'AppData', 'Roaming', appName, relativeFile))
          paths.push(join(wslUsersDir, u, 'AppData', 'Local', appName, relativeFile))
        }
      } catch {}
    }
  }

  return [...new Set(paths.filter(Boolean))]
}

/**
 * Resolves standard home-relative config paths (e.g. ~/.codex/auth.json)
 */
export function getHomeConfigPaths(folderName: string, fileName: string): string[] {
  const home = homedir()
  const paths: string[] = [
    join(home, `.${folderName}`, fileName),
    join(home, '.config', folderName, fileName),
  ]

  if (process.env.USERPROFILE && process.env.USERPROFILE !== home) {
    paths.push(join(process.env.USERPROFILE, `.${folderName}`, fileName))
  }

  return [...new Set(paths.filter(Boolean))]
}

/**
 * Atomically writes JSON to a file via temporary file replacement.
 * Prevents 0-byte corrupted files if application crashes or power cuts during write.
 *
 * The payload is compact (`JSON.stringify` without indentation): these files are
 * machine state, and pretty-printing roughly doubled their size (audit B3).
 * Returns `false` when both the atomic rename and the fallback write failed, so
 * callers can surface a persistence error instead of silently diverging from disk.
 */
export function atomicWriteJsonSync(filePath: string, data: any, mode = 0o600): boolean {
  const payload = JSON.stringify(data)
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
  try {
    writeFileSync(tmpPath, payload, { encoding: 'utf8', mode })
    renameSync(tmpPath, filePath)
    return true
  } catch {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {}
    try {
      // Fallback direct write
      writeFileSync(filePath, payload, { encoding: 'utf8', mode })
      return true
    } catch {
      return false
    }
  }
}
