import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Image, StatusBar, ActivityIndicator, DeviceEventEmitter, Alert } from 'react-native';
import DashboardModel from '../models/DashboardModel';
import AppUsageService from '../services/AppUsageService';

const XR_LOGO = require('../assets/xr-store-logo.png');

const BG = '#0d1b2a';
const CARD = '#1c2e45';
const TEXT_PRIMARY = '#cce0f5';
const DIVIDER = '#3a5a7a';

type InstallState = 'loading' | 'not_installed' | 'installed' | 'update_available';

type Props = {
  app: DashboardModel;
  onBack: () => void;
  onOpenStore: () => void;
};

export default function AppDetailScreen({ app, onBack, onOpenStore }: Props) {
  const [installState, setInstallState] = useState<InstallState>('loading');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const packageName = app.fileName.replace(/\.(apk|zip)$/i, '');

  const checkInstallState = useCallback(async () => {
    setInstallState('loading');
    try {
      const installedVersion = await AppUsageService.getInstalledVersion(packageName);
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
  }, [packageName, app.versionNumber]);

  useEffect(() => {
    checkInstallState();
  }, [checkInstallState]);

  const handleInstall = async () => {
    console.log('[Install] Starting download for:', packageName, 'url:', app.zipURL);
    setDownloadProgress(0);
    const sub = DeviceEventEmitter.addListener('downloadProgress', (e: { progress: number }) => {
      setDownloadProgress(e.progress);
    });
    try {
      const apkPath = await AppUsageService.downloadAndInstall(app.zipURL, packageName);
      console.log('[Install] APK saved to:', apkPath);
    } catch (e: any) {
      console.log('[Install] Error code:', (e as any)?.code, 'message:', e?.message, 'full:', JSON.stringify(e));
      Alert.alert('Install Failed', e?.message ?? 'Unknown error');
    } finally {
      sub.remove();
      setDownloadProgress(null);
      setTimeout(checkInstallState, 1500);
    }
  };

  const handleLaunch = async () => {
    await AppUsageService.launchApp(packageName);
  };

  const handleUninstall = async () => {
    await AppUsageService.uninstallApp(packageName);
    // Re-check state after returning from uninstall dialog
    setTimeout(checkInstallState, 1000);
  };

  const renderButtons = () => {
    if (installState === 'loading') {
      return <ActivityIndicator color={TEXT_PRIMARY} style={{ marginBottom: 24 }} />;
    }
    if (installState === 'not_installed') {
      return (
        <View style={styles.buttonCol}>
          {downloadProgress !== null && (
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${downloadProgress}%` }]} />
              <Text style={styles.progressText}>{downloadProgress}%</Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.installButton, downloadProgress !== null && styles.buttonDisabled]}
            onPress={handleInstall}
            disabled={downloadProgress !== null}>
            <Text style={styles.buttonText}>
              {downloadProgress !== null ? 'Installing…' : 'Install'}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (installState === 'update_available') {
      return (
        <View style={styles.buttonCol}>
          {downloadProgress !== null && (
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${downloadProgress}%` }]} />
              <Text style={styles.progressText}>{downloadProgress}%</Text>
            </View>
          )}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.updateButton, downloadProgress !== null && styles.buttonDisabled]}
              onPress={handleInstall}
              disabled={downloadProgress !== null}>
              <Text style={styles.buttonText}>
                {downloadProgress !== null ? 'Updating…' : 'Update'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.uninstallButton} onPress={handleUninstall}>
              <Text style={styles.buttonText}>Uninstall</Text>
            </TouchableOpacity>
          </View>
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
