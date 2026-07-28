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
} from 'react-native';
import { useLocalPackages } from '../hooks/useLocalPackages';
import LocalPackageModel from '../models/LocalPackageModel';
import AppUsageService from '../services/AppUsageService';

const XR_LOGO = require('../assets/xr-store-logo.png');

const BG = '#0d1b2a';
const CARD = '#1c2e45';
const TEXT_PRIMARY = '#cce0f5';

type RowState = 'checking' | 'not_installed' | 'installing' | 'installed';

type Props = {
  onBack: () => void;
};

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export default function LocalLibraryScreen({ onBack }: Props) {
  const { packages, resolvedFolder, loading, error, rescan } = useLocalPackages();
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

  const handleInstall = async (pkg: LocalPackageModel) => {
    setRowState((s) => ({ ...s, [pkg.id]: 'installing' }));
    try {
      const exePath = await AppUsageService.installLocalPackage(pkg.filePath, pkg.id);
      setExePaths((s) => ({ ...s, [pkg.id]: exePath }));
      setRowState((s) => ({ ...s, [pkg.id]: 'installed' }));
      fetchInstallFolder(pkg.id);
    } catch (e) {
      console.log('[LocalLibrary] install failed:', e);
      setRowState((s) => ({ ...s, [pkg.id]: 'not_installed' }));
    }
  };

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
          renderItem={({ item }) => {
            const state = rowState[item.id] ?? 'checking';
            return (
              <View style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>
                    {item.name}
                    {item.version ? ` (${item.version})` : ''}
                  </Text>
                  <Text style={styles.rowMeta}>{formatSize(item.sizeBytes)}</Text>
                  {!item.isValid && (
                    <Text style={styles.warnBadge}>⚠ {item.error ?? 'Invalid package'}</Text>
                  )}
                </View>
                {item.isValid && (
                  <View style={styles.buttonRow}>
                    {state === 'checking' && <ActivityIndicator color={TEXT_PRIMARY} />}
                    {state === 'not_installed' && (
                      <TouchableOpacity style={styles.installButton} onPress={() => handleInstall(item)}>
                        <Text style={styles.buttonText}>Install</Text>
                      </TouchableOpacity>
                    )}
                    {state === 'installing' && <ActivityIndicator color={TEXT_PRIMARY} />}
                    {state === 'installed' && (
                      <>
                        <TouchableOpacity style={styles.launchButton} onPress={() => handleLaunch(item)}>
                          <Text style={styles.buttonText}>Launch</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.openButton} onPress={() => handleOpenFolder(item)}>
                          <Text style={styles.buttonText}>Open</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.uninstallButton} onPress={() => handleUninstall(item)}>
                          <Text style={styles.buttonText}>Uninstall</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          }}
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
