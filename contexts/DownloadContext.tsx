import React, { createContext, useContext, useSyncExternalStore } from 'react';
import DownloadManager, { DownloadState } from '../services/DownloadManager';

const DownloadContext = createContext(DownloadManager);

type Props = { children: React.ReactNode };

export function DownloadProvider({ children }: Props) {
  return <DownloadContext.Provider value={DownloadManager}>{children}</DownloadContext.Provider>;
}

export function useDownloadManager() {
  return useContext(DownloadContext);
}

// Real-time, per-id subscription: re-renders only when this specific
// download's state changes, and returns the current progress immediately on
// mount - including right after a screen is unmounted and remounted, since
// the underlying DownloadManager state outlives any single screen.
export function useDownloadProgress(id: string): DownloadState {
  const manager = useDownloadManager();
  return useSyncExternalStore(
    (onStoreChange) => manager.subscribe(id, onStoreChange),
    () => manager.getSnapshot(id),
  );
}
