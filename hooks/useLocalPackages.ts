import { useCallback, useEffect, useState } from 'react';
import LocalPackageModel from '../models/LocalPackageModel';
import PackageWatcherService from '../services/PackageWatcherService';

export function useLocalPackages(folderPath?: string) {
  const [packages, setPackages] = useState<LocalPackageModel[]>([]);
  const [resolvedFolder, setResolvedFolder] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const changedSub = PackageWatcherService.onPackagesChanged((pkgs) => {
      if (!cancelled) setPackages(pkgs);
    });
    const errorSub = PackageWatcherService.onScanError((msg) => {
      if (!cancelled) setError(msg);
    });

    (async () => {
      try {
        const folder = await PackageWatcherService.startWatching(folderPath);
        if (!cancelled) setResolvedFolder(folder);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      changedSub.remove();
      errorSub.remove();
      PackageWatcherService.stopWatching();
    };
  }, [folderPath]);

  const rescan = useCallback(async () => {
    const pkgs = await PackageWatcherService.scanNow();
    setPackages(pkgs);
  }, []);

  return { packages, resolvedFolder, loading, error, rescan };
}
