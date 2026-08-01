import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Image,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalPackages } from '../hooks/useLocalPackages';
import LocalPackageModel from '../models/LocalPackageModel';
import AppUsageService from '../services/AppUsageService';
import { formatDownloadLabel } from '../services/DownloadManager';
import { useDownloadManager, useDownloadProgress } from '../contexts/DownloadContext';

const XR_LOGO = require('../assets/xr-store-logo.png');

const BG = '#0d1b2a';
const CARD = '#1c2e45';
const TEXT_PRIMARY = '#cce0f5';

const ACTIVE_DOWNLOAD_STATUSES = new Set(['downloading', 'extracting', 'launching']);

type RowState = 'checking' | 'not_installed' | 'installed';

type Props = {
  onBack: () => void;
};

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

type RowProps = {
  pkg: LocalPackageModel;
  rowState: RowState;
  onInstall: (pkg: LocalPackageModel) => void;
  onLaunch: (pkg: LocalPackageModel) => void;
  onOpenFolder: (pkg: LocalPackageModel) => void;
  onUninstall: (pkg: LocalPackageModel) => void;
  onInstallComplete: (pkg: LocalPackageModel, installPath?: string) => void;
};

// Per-row component (rather than inlining in FlatList's renderItem) so each
// row can subscribe to its own package's progress via a hook - hooks can't be
// called from a plain renderItem callback, which isn't a real component.
function LibraryRow({ pkg, rowState, onInstall, onLaunch, onOpenFolder, onUninstall, onInstallComplete }: RowProps) {
  const download = useDownloadProgress(pkg.id);

  useEffect(() => {
    if (download.status === 'completed') {
      onInstallComplete(pkg, download.installPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [download.status, download.installPath]);

  const isActive = ACTIVE_DOWNLOAD_STATUSES.has(download.status);

  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName}>
          {pkg.name}
          {pkg.version ? ` (${pkg.version})` : ''}
        </Text>
        <Text style={styles.rowMeta}>{formatSize(pkg.sizeBytes)}</Text>
        {!pkg.isValid && <Text style={styles.warnBadge}>⚠ {pkg.error ?? 'Invalid package'}</Text>}
        {isActive && (
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${Math.min(100, Math.max(0, download.percent))}%` }]} />
          </View>
        )}
        {isActive && <Text style={styles.progressText}>{formatDownloadLabel(download)}</Text>}
        {download.status === 'error' && <Text style={styles.warnBadge}>{download.error ?? 'Install failed'}</Text>}
      </View>
      {pkg.isValid && (
        <View style={styles.buttonRow}>
          {!isActive && download.status === 'error' && (
            <TouchableOpacity style={styles.installButton} onPress={() => onInstall(pkg)}>
              <Text style={styles.buttonText}>Retry</Text>
            </TouchableOpacity>
          )}
          {!isActive && download.status !== 'error' && rowState === 'checking' && (
            <ActivityIndicator color={TEXT_PRIMARY} />
          )}
          {!isActive && download.status !== 'error' && rowState === 'not_installed' && (
            <TouchableOpacity style={styles.installButton} onPress={() => onInstall(pkg)}>
              <Text style={styles.buttonText}>Install</Text>
            </TouchableOpacity>
          )}
          {!isActive && download.status !== 'error' && rowState === 'installed' && (
            <>
              <TouchableOpacity style={styles.launchButton} onPress={() => onLaunch(pkg)}>
                <Text style={styles.buttonText}>Launch</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.openButton} onPress={() => onOpenFolder(pkg)}>
                <Text style={styles.buttonText}>Open</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uninstallButton} onPress={() => onUninstall(pkg)}>
                <Text style={styles.buttonText}>Uninstall</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

export default function LocalLibraryScreen({ onBack }: Props) {
  const { packages, resolvedFolder, loading, error, rescan } = useLocalPackages();
  const downloadManager = useDownloadManager();
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [exePaths, setExePaths] = useState<Record<string, string>>({});
  const [installFolders, setInstallFolders] = useState<Record<string, string>>({});

  const fetchInstallFolder = useCallback(async (pkgId: string) => {
    try {
      const folder = await AppUsageService.getInstallFolder(pkgId);
      setInstallFolders((s) => ({ ...s, [pkgId]: folder }));
    } catch (e) {
      console.log('[LocalLibrary] getInstallFolder failed:', e);
    }
  }, []);

  const checkOne = useCallback(async (pkg: LocalPackageModel) => {
    if (!pkg.isValid) return;
    try {
      const exePath = await AppUsageService.checkLocalInstall(pkg.id);
      setRowState((s) => ({ ...s, [pkg.id]: exePath ? 'installed' : 'not_installed' }));
      if (exePath) {
        setExePaths((s) => ({ ...s, [pkg.id]: exePath }));
        fetchInstallFolder(pkg.id);
      }
    } catch (e) {
      console.log('[LocalLibrary] checkLocalInstall failed:', e);
      setRowState((s) => ({ ...s, [pkg.id]: 'not_installed' }));
    }
  }, [fetchInstallFolder]);

  useEffect(() => {
    packages.forEach((pkg) => {
      if (!rowState[pkg.id]) checkOne(pkg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packages]);

  const handleInstall = (pkg: LocalPackageModel) => {
    // De-duped in DownloadManager itself too, but this keeps a rapid
    // double-tap from even issuing a second native call.
    if (ACTIVE_DOWNLOAD_STATUSES.has(downloadManager.getSnapshot(pkg.id).status)) return;
    downloadManager.startLocalInstall(pkg.id, pkg.filePath);
  };

  const handleInstallComplete = useCallback((pkg: LocalPackageModel, installPath?: string) => {
    if (installPath) {
      setExePaths((s) => ({ ...s, [pkg.id]: installPath }));
    }
    setRowState((s) => ({ ...s, [pkg.id]: 'installed' }));
    fetchInstallFolder(pkg.id);
  }, [fetchInstallFolder]);

  const handleLaunch = async (pkg: LocalPackageModel) => {
    const exePath = exePaths[pkg.id];
    if (exePath) await AppUsageService.launchApp(exePath);
  };

  const handleOpenFolder = async (pkg: LocalPackageModel) => {
    const folder = installFolders[pkg.id];
    if (folder) await AppUsageService.openFolder(folder);
  };

  const handleUninstall = async (pkg: LocalPackageModel) => {
    try {
      await AppUsageService.uninstallApp(pkg.id);
    } catch (e) {
      console.log('[LocalLibrary] uninstall failed:', e);
      Alert.alert(
        'Uninstall failed',
        'Could not fully remove the app. Make sure it isn\'t still running, then try again.',
      );
      return;
    }
    setRowState((s) => ({ ...s, [pkg.id]: 'not_installed' }));
    setExePaths((s) => { const next = { ...s }; delete next[pkg.id]; return next; });
    setInstallFolders((s) => { const next = { ...s }; delete next[pkg.id]; return next; });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      <View style={styles.header}>
        <Image source={XR_LOGO} style={styles.logoImage} resizeMode="contain" />
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>My Library</Text>
      {!!resolvedFolder && <Text style={styles.folderLabel}>{resolvedFolder}</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color={TEXT_PRIMARY} style={styles.loadingIndicator} />
      ) : packages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            No packages found. Copy a .zip file into the folder above to see it here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={packages}
          keyExtractor={(pkg) => pkg.id}
          onRefresh={rescan}
          refreshing={false}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <LibraryRow
              pkg={item}
              rowState={rowState[item.id] ?? 'checking'}
              onInstall={handleInstall}
              onLaunch={handleLaunch}
              onOpenFolder={handleOpenFolder}
              onUninstall={handleUninstall}
              onInstallComplete={handleInstallComplete}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  logoImage: {
    width: 120,
    height: 44,
  },
  backButton: {
    backgroundColor: '#2a4060',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  backButtonText: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '500',
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: '400',
    marginBottom: 4,
  },
  folderLabel: {
    color: TEXT_PRIMARY,
    fontSize: 12,
    opacity: 0.6,
    marginBottom: 16,
  },
  errorText: {
    color: '#e08a7a',
    fontSize: 13,
    marginBottom: 12,
  },
  loadingIndicator: {
    marginTop: 30,
  },
  emptyState: {
    marginTop: 40,
    paddingHorizontal: 20,
  },
  emptyText: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    textAlign: 'center',
    opacity: 0.7,
    lineHeight: 22,
  },
  row: {
    backgroundColor: CARD,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    marginBottom: 12,
  },
  rowInfo: {
    flex: 1,
    gap: 4,
    marginRight: 12,
  },
  rowName: {
    color: TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: '500',
  },
  rowMeta: {
    color: TEXT_PRIMARY,
    fontSize: 12,
    opacity: 0.6,
  },
  warnBadge: {
    color: '#e0b03a',
    fontSize: 12,
    marginTop: 2,
  },
  progressBarTrack: {
    height: 14,
    backgroundColor: '#1a2d42',
    borderRadius: 7,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#2a6aad',
    borderRadius: 7,
  },
  progressText: {
    color: TEXT_PRIMARY,
    fontSize: 11,
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  installButton: {
    backgroundColor: '#2a6aad',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  launchButton: {
    backgroundColor: '#4a8a3a',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  openButton: {
    backgroundColor: '#4a5a8a',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  uninstallButton: {
    backgroundColor: '#7a2a20',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  buttonText: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '500',
  },
});
