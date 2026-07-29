import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Image, StatusBar, ActivityIndicator, Platform } from 'react-native';
import DashboardModel from '../models/DashboardModel';
import AppUsageService from '../services/AppUsageService';
import { formatDownloadLabel } from '../services/DownloadManager';
import { useDownloadManager, useDownloadProgress } from '../contexts/DownloadContext';

const XR_LOGO = require('../assets/xr-store-logo.png');

// Persists installed exe paths within the app session on Windows (no native API to query)
const windowsInstalledApps = new Map<string, string>();

// Statuses that replace the normal Install/Launch/Uninstall row with the
// progress UI. Pause/Resume/Stop controls are only offered during the actual
// 'downloading'/'paused' phases - extraction and launching are single blocking
// native calls that can't be meaningfully paused or cancelled mid-way.
const ACTIVE_DOWNLOAD_STATUSES = new Set(['downloading', 'extracting', 'launching', 'paused']);

const BG = '#0d1b2a';
const CARD = '#1c2e45';
const TEXT_PRIMARY = '#cce0f5';
const DIVIDER = '#3a5a7a';

type InstallState = 'loading' | 'not_installed' | 'installed' | 'update_available' | 'installing';

type Props = {
  app: DashboardModel;
  onBack: () => void;
  onOpenStore: () => void;
};

export default function AppDetailScreen({ app, onBack, onOpenStore }: Props) {
  const [installState, setInstallState] = useState<InstallState>('loading');
  const [packageName, setPackageName] = useState<string>('');
  const downloadManager = useDownloadManager();
  const download = useDownloadProgress(app.fileName);

  // Download completion arrives asynchronously via the native event stream, so
  // it may land well after handleInstall's own call returned (e.g. the screen
  // was remounted mid-download and startDownload no-op'd into the existing one).
  useEffect(() => {
    if (Platform.OS !== 'windows' || download.status !== 'completed') return;
    if (download.installPath) {
      windowsInstalledApps.set(app.fileName, download.installPath);
    }
    setInstallState('installed');
  }, [download.status, download.installPath, app.fileName]);

  const checkInstallState = useCallback(async (pkgName: string) => {
    if (Platform.OS === 'windows') {
      const installedPath = windowsInstalledApps.get(app.fileName);
      setInstallState(installedPath ? 'installed' : 'not_installed');
      return;
    }
    if (!pkgName) {
      setInstallState('not_installed');
      return;
    }
    setInstallState('loading');
    try {
      const installedVersion = await AppUsageService.getInstalledVersion(pkgName);
      if (installedVersion === null) {
        setInstallState('not_installed');
      } else if (installedVersion !== app.versionNumber) {
        setInstallState('update_available');
      } else {
        setInstallState('installed');
      }
    } catch {
      setInstallState('not_installed');
    }
  }, [app.versionNumber]);

  useEffect(() => {
    checkInstallState(packageName);
  }, [checkInstallState, packageName]);

  const handleInstall = async () => {
    if (Platform.OS === 'windows') {
      // DownloadManager de-dupes internally too, but bail out early here so a
      // rapid double-tap never even issues a second call.
      if (ACTIVE_DOWNLOAD_STATUSES.has(download.status)) return;
      downloadManager.startDownload(app.fileName, app.zipURL, app.fileName);
      return;
    }
    console.log('[Install] Button tapped');
    console.log('[Install] zipURL:', app.zipURL);
    console.log('[Install] fileName:', app.fileName);
    setInstallState('installing');
    try {
      console.log('[Install] Starting download from:', app.zipURL);
      const resolvedPackageName = await AppUsageService.installApp(app.zipURL, app.fileName);
      console.log('[Install] Download & extraction complete');
      if (resolvedPackageName) {
        setPackageName(resolvedPackageName);
      }
      setTimeout(() => checkInstallState(resolvedPackageName || packageName), 2000);
    } catch (e) {
      console.log('[Install] installApp error:', e);
      checkInstallState(packageName);
    }
  };

  const handlePause = () => {
    downloadManager.pauseDownload(app.fileName);
  };

  const handleResume = () => {
    downloadManager.resumeDownload(app.fileName, app.zipURL, app.fileName);
  };

  const handleStop = () => {
    downloadManager.cancelDownload(app.fileName);
  };

  const handleLaunch = async () => {
    if (Platform.OS === 'windows') {
      const exePath = windowsInstalledApps.get(app.fileName);
      console.log('[Launch] exePath:', exePath);
      if (exePath) {
        await AppUsageService.launchApp(exePath);
      }
      return;
    }
    await AppUsageService.launchApp(packageName);
  };

  const handleUninstall = async () => {
    if (Platform.OS === 'windows') {
      try {
        await AppUsageService.uninstallApp(app.fileName);
        windowsInstalledApps.delete(app.fileName);
      } catch (e) {
        console.log('[Uninstall] failed to remove app files:', e);
      }
      checkInstallState(packageName);
      return;
    }
    await AppUsageService.uninstallApp(packageName);
    setTimeout(() => checkInstallState(packageName), 1000);
  };

  const renderButtons = () => {
    if (Platform.OS === 'windows' && ACTIVE_DOWNLOAD_STATUSES.has(download.status)) {
      const isPaused = download.status === 'paused';
      const isDownloading = download.status === 'downloading';
      return (
        <View style={styles.buttonCol}>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${Math.min(100, Math.max(0, download.percent))}%` }]} />
          </View>
          <Text style={styles.progressText}>{formatDownloadLabel(download)}</Text>
          {(isDownloading || isPaused) && (
            <View style={styles.buttonRow}>
              {isDownloading && (
                <TouchableOpacity style={styles.updateButton} onPress={handlePause}>
                  <Text style={styles.buttonText}>Pause</Text>
                </TouchableOpacity>
              )}
              {isPaused && (
                <TouchableOpacity style={styles.installButton} onPress={handleResume}>
                  <Text style={styles.buttonText}>Resume</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.uninstallButton} onPress={handleStop}>
                <Text style={styles.buttonText}>Stop</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    }
    if (Platform.OS === 'windows' && download.status === 'error') {
      return (
        <View style={styles.buttonCol}>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.installButton} onPress={handleInstall}>
              <Text style={styles.buttonText}>Retry Install</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.errorText}>{download.error ?? 'Install failed'}</Text>
        </View>
      );
    }
    if (installState === 'loading') {
      return <ActivityIndicator color={TEXT_PRIMARY} style={{ marginBottom: 24 }} />;
    }
    if (installState === 'installing') {
      return (
        <View style={styles.buttonRow}>
          <ActivityIndicator color={TEXT_PRIMARY} style={{ marginBottom: 24 }} />
          <Text style={[styles.buttonText, { marginBottom: 24, marginLeft: 8 }]}>Installing...</Text>
        </View>
      );
    }
    if (installState === 'not_installed') {
      return (
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.installButton} onPress={handleInstall}>
            <Text style={styles.buttonText}>Install</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (installState === 'update_available') {
      return (
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.updateButton} onPress={handleInstall}>
            <Text style={styles.buttonText}>Update</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.uninstallButton} onPress={handleUninstall}>
            <Text style={styles.buttonText}>Uninstall</Text>
          </TouchableOpacity>
        </View>
      );
    }
    // installed
    return (
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.launchButton} onPress={handleLaunch}>
          <Text style={styles.buttonText}>Launch</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.uninstallButton} onPress={handleUninstall}>
          <Text style={styles.buttonText}>Uninstall</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onOpenStore}>
          <Image source={XR_LOGO} style={styles.logoImage} resizeMode="contain" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      {/* Main Card */}
      <ScrollView style={styles.card} contentContainerStyle={{ padding: 16, flexGrow: 1 }} showsVerticalScrollIndicator={false}>

        {/* Banner Image */}
        <Image source={{ uri: app.bannerURL }} style={styles.bannerImage} resizeMode="cover" />

        {/* Title */}
        <Text style={styles.title}>{app.applicationName}</Text>

        {/* Version & Size */}
        <Text style={styles.meta}>Version {app.versionNumber}  ·  {app.fileSize}</Text>

        {/* Action Buttons */}
        {renderButtons()}

        {/* Summary */}
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.divider} />
        <Text style={styles.sectionContent}>{app.summary}</Text>

        {/* Patch Notes */}
        <Text style={styles.sectionTitle}>Patch Notes</Text>
        <View style={styles.divider} />
        <Text style={styles.sectionContent}>{app.patchNotes}</Text>

      </ScrollView>
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
    marginBottom: 16,
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
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    flex: 1,
  },
  bannerImage: {
    backgroundColor: '#8fa8c0',
    borderRadius: 10,
    height: 180,
    marginBottom: 16,
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 26,
    fontWeight: '400',
    marginBottom: 6,
  },
  meta: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    opacity: 0.7,
    marginBottom: 16,
  },
  buttonCol: {
    marginBottom: 24,
    gap: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  progressBarTrack: {
    height: 20,
    backgroundColor: '#1a2d42',
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#2a6aad',
    borderRadius: 10,
  },
  progressText: {
    color: TEXT_PRIMARY,
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
  errorText: {
    color: '#e07a6a',
    fontSize: 12,
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  installButton: {
    backgroundColor: '#2a6aad',
    borderRadius: 8,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  launchButton: {
    backgroundColor: '#4a8a3a',
    borderRadius: 8,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  updateButton: {
    backgroundColor: '#a06020',
    borderRadius: 8,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  uninstallButton: {
    backgroundColor: '#7a2a20',
    borderRadius: 8,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  buttonText: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '500',
  },
  sectionTitle: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '400',
    marginTop: 8,
    marginBottom: 6,
  },
  divider: {
    height: 1,
    backgroundColor: DIVIDER,
    marginBottom: 10,
  },
  sectionContent: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
    opacity: 0.75,
  },
});
