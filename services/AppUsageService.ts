import { NativeModules, Platform } from 'react-native';

const { AppUsageModule, InstallModule } = NativeModules;

const isAvailable = Platform.OS === 'android' && AppUsageModule != null;
const isWindows = Platform.OS === 'windows';

export type AppUsageStats = {
  packageName: string;
  totalTimeInForeground: number; // milliseconds
  totalTimeFormatted: string;    // "HH:MM"
};

const AppUsageService = {
  openUsageSettings(): void {
    if (!isAvailable) return;
    AppUsageModule.openUsageSettings();
  },

  async getAppUsage(packageName: string): Promise<AppUsageStats> {
    if (!isAvailable) {
      return { packageName, totalTimeInForeground: 0, totalTimeFormatted: '00:00' };
    }
    return AppUsageModule.getAppUsage(packageName);
  },

  async getInstalledVersion(packageName: string): Promise<string | null> {
    if (!isAvailable) return null;
    return AppUsageModule.getInstalledVersion(packageName);
  },

  async launchApp(packageNameOrPath: string, token?: string, email?: string): Promise<void> {
    if (isWindows && InstallModule) {
      // Windows launches always forward the current user's token/email so the
      // launched app can authenticate as them.
      await InstallModule.launchApp(packageNameOrPath, token ?? '', email ?? '');
      return;
    }
    if (!isAvailable) return;
    return AppUsageModule.launchApp(packageNameOrPath);
  },

  async installApp(zipUrl: string, fileName: string): Promise<string> {
    console.log('[AppUsageService] Platform.OS:', Platform.OS);
    console.log('[AppUsageService] isWindows:', isWindows);
    console.log('[AppUsageService] InstallModule:', InstallModule);
    console.log('[AppUsageService] isAvailable:', isAvailable);
    if (isWindows && InstallModule) {
      console.log('[AppUsageService] Using InstallModule (Windows)');
      return InstallModule.installApp(zipUrl, fileName);
    }
    if (isWindows && !InstallModule) {
      console.log('[AppUsageService] ERROR: InstallModule is null on Windows - module not registered');
    }
    if (!isAvailable) return '';
    return AppUsageModule.installApp(zipUrl, fileName);
  },

  async uninstallApp(packageNameOrPath: string): Promise<void> {
    if (isWindows && InstallModule) {
      await InstallModule.uninstallApp(packageNameOrPath);
      return;
    }
    if (!isAvailable) return;
    return AppUsageModule.uninstallApp(packageNameOrPath);
  },

  async downloadAndInstall(zipUrl: string, fileName: string): Promise<void> {
    if (!isAvailable) return;
    return AppUsageModule.downloadAndInstall(zipUrl, fileName);
  },
};

export default AppUsageService;
