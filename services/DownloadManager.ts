import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { InstallModule } = NativeModules;

const isWindows = Platform.OS === 'windows';
const isSupported = isWindows && InstallModule != null;
const emitter = isSupported ? new NativeEventEmitter(InstallModule) : null;

const STORAGE_KEY = 'xrstore.downloads.progress';
// Blocks a duplicate Install/Resume call from being issued while one of these
// is already in flight. Deliberately excludes 'paused' - a paused download
// has no running thread, so calling startDownload again is exactly how it
// resumes (installApp detects the paused state itself and continues via
// HTTP Range instead of restarting).
const ACTIVE_STATUSES = new Set(['downloading', 'extracting', 'launching']);
// Used only when rehydrating from AsyncStorage: both of these mean "there was
// a live native thread for this id at last write," which may no longer be
// true if the process restarted - so both get reconciled against native
// truth via getDownloadStatus rather than trusted blindly.
const RECONCILE_STATUSES = new Set(['downloading', 'extracting', 'launching', 'paused']);

export type DownloadStatus = 'idle' | 'downloading' | 'paused' | 'extracting' | 'launching' | 'completed' | 'error';

export type DownloadState = {
  id: string;
  status: DownloadStatus;
  percent: number;
  bytesReceived: number;
  totalBytes: number;
  speedBps: number;
  error?: string;
  downloadPath?: string;
  installPath?: string;
};

const IDLE_STATE: DownloadState = {
  id: '',
  status: 'idle',
  percent: 0,
  bytesReceived: 0,
  totalBytes: 0,
  speedBps: 0,
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

// Shared by both the remote-download flow (Store) and the local-install flow
// (My Library) so their progress rows read consistently.
export function formatDownloadLabel(d: DownloadState): string {
  const pct = Math.round(d.percent);
  const size = d.totalBytes > 0 ? `${formatBytes(d.bytesReceived)} / ${formatBytes(d.totalBytes)}` : formatBytes(d.bytesReceived);
  if (d.status === 'paused') {
    return `Paused · ${pct}% · ${size}`;
  }
  const stage = d.status === 'extracting' ? 'Extracting' : d.status === 'launching' ? 'Launching' : 'Downloading';
  const speed = d.speedBps > 0 ? ` · ${formatBytes(d.speedBps)}/s` : '';
  return `${stage}… ${pct}% · ${size}${speed}`;
}

type Listener = () => void;

// Module-scope singleton: state and the native event subscription live for the
// whole app session, independent of which screen happens to be mounted. This
// is what lets a download keep progressing (and reporting progress) while the
// user navigates to another screen and back.
class DownloadManagerImpl {
  private states = new Map<string, DownloadState>();
  private subscribers = new Map<string, Set<Listener>>();
  private lastPersistAt = 0;

  constructor() {
    if (emitter) {
      emitter.addListener('onDownloadProgress', this.handleNativeProgress);
    }
    this.hydrate();
  }

  private handleNativeProgress = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (!parsed?.id) return;
      this.applyState(parsed.id, parsed, { immediate: parsed.status !== 'downloading' });
    } catch {
      // ignore malformed payloads
    }
  };

  private applyState(id: string, patch: Partial<DownloadState>, opts?: { immediate?: boolean }) {
    const next: DownloadState = {
      ...IDLE_STATE,
      ...this.states.get(id),
      ...patch,
      id,
    };
    this.states.set(id, next);
    this.subscribers.get(id)?.forEach(cb => cb());
    this.persist(opts?.immediate ?? true);
  }

  private persist(immediate: boolean) {
    const now = Date.now();
    if (!immediate && now - this.lastPersistAt < 1000) return;
    this.lastPersistAt = now;
    const snapshot: Record<string, DownloadState> = {};
    this.states.forEach((value, key) => { snapshot[key] = value; });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => {
      // best-effort persistence only
    });
  }

  private async hydrate() {
    if (!isSupported) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const persisted: Record<string, DownloadState> = JSON.parse(raw);
      for (const id of Object.keys(persisted)) {
        const entry = persisted[id];
        if (!RECONCILE_STATUSES.has(entry.status)) {
          this.states.set(id, entry);
          continue;
        }
        // The persisted status was still active when we last wrote it, but the
        // app/process may have restarted since - reconcile against native truth
        // rather than trusting a possibly-stale "downloading" forever.
        try {
          const json = await InstallModule.getDownloadStatus(id);
          if (json) {
            const native = JSON.parse(json);
            this.states.set(id, { ...IDLE_STATE, ...entry, ...native, id });
          } else {
            this.states.set(id, { ...entry, status: 'error', error: 'Download was interrupted' });
          }
        } catch {
          this.states.set(id, { ...entry, status: 'error', error: 'Download was interrupted' });
        }
        this.subscribers.get(id)?.forEach(cb => cb());
      }
    } catch {
      // ignore corrupt storage
    }
  }

  getSnapshot(id: string): DownloadState {
    return this.states.get(id) ?? IDLE_STATE;
  }

  subscribe(id: string, cb: Listener): () => void {
    if (!this.subscribers.has(id)) this.subscribers.set(id, new Set());
    const set = this.subscribers.get(id)!;
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.subscribers.delete(id);
    };
  }

  isSupported(): boolean {
    return isSupported;
  }

  async startDownload(id: string, zipUrl: string, fileName: string): Promise<void> {
    if (!isSupported) return;
    const current = this.states.get(id);
    if (current && ACTIVE_STATUSES.has(current.status)) {
      return; // already in flight for this id - de-dupe repeated Install clicks
    }
    // A paused download resumes via this same call (native detects the
    // paused state and continues via Range) - keep its progress on screen
    // instead of flashing back to 0% while the resume request is in flight.
    const isResume = current?.status === 'paused' && current.bytesReceived > 0;
    if (isResume) {
      this.applyState(id, { status: 'downloading', speedBps: 0, error: undefined }, { immediate: true });
    } else {
      this.applyState(id, { status: 'downloading', percent: 0, bytesReceived: 0, totalBytes: 0, speedBps: 0, error: undefined }, { immediate: true });
    }
    try {
      await InstallModule.installApp(id, zipUrl, fileName);
    } catch (e: any) {
      // ALREADY_IN_PROGRESS/PAUSED/CANCELLED are all native telling us the
      // corresponding onDownloadProgress event already updated state - no
      // separate error handling needed.
      if (e?.code === 'ALREADY_IN_PROGRESS' || e?.code === 'PAUSED' || e?.code === 'CANCELLED') return;
      this.applyState(id, { status: 'error', error: e?.message ?? 'Install failed' }, { immediate: true });
    }
  }

  async pauseDownload(id: string): Promise<void> {
    if (!isSupported) return;
    try {
      await InstallModule.pauseDownload(id);
    } catch {
      // best-effort; native no-ops safely if there's nothing to pause
    }
  }

  // Resuming is just re-issuing startDownload - see the isResume branch above.
  resumeDownload(id: string, zipUrl: string, fileName: string): Promise<void> {
    return this.startDownload(id, zipUrl, fileName);
  }

  async cancelDownload(id: string): Promise<void> {
    if (!isSupported) return;
    try {
      await InstallModule.cancelDownload(id);
    } catch {
      // best-effort; native resets state on its own even without this resolving
    }
  }

  // Local Library flow: the package zip is already on disk, so there's no
  // network download phase - it goes straight to "extracting". Otherwise this
  // mirrors startDownload exactly (same dedup, same persistence, same events).
  async startLocalInstall(id: string, filePath: string): Promise<void> {
    if (!isSupported) return;
    const current = this.states.get(id);
    if (current && ACTIVE_STATUSES.has(current.status)) {
      return;
    }
    this.applyState(id, { status: 'extracting', percent: 0, bytesReceived: 0, totalBytes: 0, speedBps: 0, error: undefined }, { immediate: true });
    try {
      await InstallModule.installLocalPackage(filePath, id);
    } catch (e: any) {
      if (e?.code === 'ALREADY_IN_PROGRESS') return;
      this.applyState(id, { status: 'error', error: e?.message ?? 'Install failed' }, { immediate: true });
    }
  }
}

const DownloadManager = new DownloadManagerImpl();
export default DownloadManager;
