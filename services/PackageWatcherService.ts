import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import LocalPackageModel from '../models/LocalPackageModel';

const { PackageWatcherModule } = NativeModules;

const isWindows = Platform.OS === 'windows';
const isSupported = isWindows && PackageWatcherModule != null;
const emitter = isSupported ? new NativeEventEmitter(PackageWatcherModule) : null;

type Subscription = { remove(): void };
const noopSubscription: Subscription = { remove() {} };

const PackageWatcherService = {
  isSupported(): boolean {
    return isSupported;
  },

  async startWatching(folderPath?: string): Promise<string> {
    if (!isSupported) return '';
    return PackageWatcherModule.startWatching(folderPath ?? '');
  },

  async stopWatching(): Promise<void> {
    if (!isSupported) return;
    return PackageWatcherModule.stopWatching();
  },

  async scanNow(): Promise<LocalPackageModel[]> {
    if (!isSupported) return [];
    const json = await PackageWatcherModule.scanNow();
    return LocalPackageModel.fromJsonArray(json);
  },

  onPackagesChanged(cb: (pkgs: LocalPackageModel[]) => void): Subscription {
    if (!emitter) return noopSubscription;
    return emitter.addListener('onPackagesChanged', (json: string) => {
      cb(LocalPackageModel.fromJsonArray(json));
    });
  },

  onScanError(cb: (message: string) => void): Subscription {
    if (!emitter) return noopSubscription;
    return emitter.addListener('onScanError', cb);
  },
};

export default PackageWatcherService;
