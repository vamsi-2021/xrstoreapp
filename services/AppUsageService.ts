import { NativeModules, Platform } from 'react-native';
import AuthService from './AuthService';
import NetworkService from './NetworkService';

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

  // Forwards this app's own session credentials to the launched app so it can
  // auto-login instead of showing its own login screen - see StartupArgsService
  // + App.tsx for the JS side that reads them back on startup.
  async launchApp(packageNameOrPath: string): Promise<void> {
    if (isWindows && InstallModule) {
      const token = NetworkService.getToken() ?? '';
      const email = AuthService.getCurrentUser()?.email ?? '';
      await InstallModule.launchApp(packageNameOrPath, token, email);
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

  async installLocalPackage(filePath: string, packageId: string): Promise<string> {
    if (isWindows && InstallModule) {
      return InstallModule.installLocalPackage(filePath, packageId);
    }
    return '';
  },

  async checkLocalInstall(packageId: string): Promise<string | null> {
    if (isWindows && InstallModule) {
      return InstallModule.checkLocalInstall(packageId);
    }
    return null;
  },

  async getInstallFolder(packageId: string): Promise<string> {
    if (isWindows && InstallModule) {
      return InstallModule.getInstallFolder(packageId);
    }
    return '';
  },

  async openFolder(path: string): Promise<void> {
    if (isWindows && InstallModule) {
      return InstallModule.openFolder(path);
    }
  },
};

export default AppUsageService;
