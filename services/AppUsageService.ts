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

  async launchApp(packageName: string): Promise<void> {
    if (!isAvailable) return;
    return AppUsageModule.launchApp(packageName);
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

  async uninstallApp(packageName: string): Promise<void> {
    if (!isAvailable) return;
    return AppUsageModule.uninstallApp(packageName);
  },
};

export default AppUsageService;
