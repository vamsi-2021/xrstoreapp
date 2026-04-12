import { NativeModules, Platform } from 'react-native';

const { AppUsageModule } = NativeModules;

const isAvailable = Platform.OS === 'android' && AppUsageModule != null;

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

  async uninstallApp(packageName: string): Promise<void> {
    if (!isAvailable) return;
    return AppUsageModule.uninstallApp(packageName);
  },

  async downloadAndInstall(zipUrl: string, fileName: string): Promise<void> {
    if (!isAvailable) return;
    return AppUsageModule.downloadAndInstall(zipUrl, fileName);
  },
};

export default AppUsageService;
