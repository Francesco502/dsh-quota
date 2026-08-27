import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

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
