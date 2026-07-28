import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Image, StatusBar, ActivityIndicator, Platform } from 'react-native';
import DashboardModel from '../models/DashboardModel';
import AppUsageService from '../services/AppUsageService';
import NetworkService from '../services/NetworkService';

const XR_LOGO = require('../assets/xr-store-logo.png');

// Persists installed exe paths within the app session on Windows (no native API to query)
const windowsInstalledApps = new Map<string, string>();

// TEMP: hardcoded zip URL for testing install flow — remove before shipping
const TEST_ZIP_URL = 'https://betaflix-xr-store.s3.us-east-1.amazonaws.com/DevBuild%207-20-26.zip?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEIn%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJGMEQCIFnzBE1izU%2FA2BDQjuGszweS%2BQLcK4xNoo6cK9OanD4uAiAkfiZnbOGIeiWe6IJPOrylful7ETcRxp0qckyexN0JdSrQAwhSEAQaDDM4Nzk2Mjg0MjU5NSIMwbvGA0lB2VQBcNh8Kq0DfnB8FKiwDKKIFC8eru9vyYhg9BAasX0RmZl9m3Z2INO2Ynhqfu6okhLJPSiH25iJ4TSOyo8mcp%2FntrvMLAc8me2g89voSL4gaNT93QDxrN7BqZKVvGwDNutFY14U3fqOWQPq98%2BTQMm08a%2BVKc9af61X%2FPntVS4eBEuUrnDAEOHwtJA4riRAliY69R%2BVLfFxFBqLSUAviofijE4BnhJBirpuFUkXm%2BcI0Fu0hDJmAyE7h1ok%2BJ8nLqxz9wSvo0yJTavarXVlvwa6XLujXK%2Bz44crv7FvaJrH4RGhb%2FwcJQ%2BUIB6YhEoLs%2BM6KQVrOjXmZJIjUcYkczvk8wj5LI5dM7bE%2BBT1A678geDhxZtEbQgxxxE797U1mUGANnhYPhILKvJxOF1Vyt%2FCgTGHPTx6xGpi4gXxa9%2BCs0KgaJTD6O%2FLWROzZLjOPTjHCKEXr6lRfCBZVabFZK6dRsnlUVtXGaMZzp4bX3fpLBya7hNYXcrSUkHU8UVQxkgKLJAkYTEPd8nx3iiFvq%2BE%2Fmo0PvgqM3hOOfpYG2fG7JaLYCAg2LxYlzB5G8aXgwAqxXtMMIfjndMGOt8C81aF3SJdYUnILvytbBvY%2FVEJUBBAPnzWMPS4DVgOrOqUAoDpMIIc0agBlJOB8CEvKBxX8lXIDRXM175weTGM4ZVT928rENRQsTXpEdjAwEWUIKyWbh6lzYh1RyTQ%2Fc0RkwWY21fxPcV3DS%2FHi9Mb2Fc9Zsyee%2FT%2BP4YpGDpLyYbxwqQpSpI6dEpru355zg4Jbh%2BGesStjDzDrCdjAmlVSjDyIiCD8tN92mCNhSBFbHQgHo1qiyyn4h8u123da0FUF6IJAubJiPb2wRDTwBA%2FdoH9m2CFzkRAqvpjHs8C0T2iWybYElXu9TgWD0zY8rLA2RiM%2FHl4U9IxZUvNMFh%2BXbC%2BiVSWtFUWiG9I4j8nB9DpwTcqKdzfCAQFwOVafciENZg7PEhSmdIbeXXWqPdy%2B34DcgPaz3vRmBZwe6F%2F%2F4TNkzk5TRnbuGCSTp4YVGaEPLJqY5FBkqKYTgKl4Zyj&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIAVUVDDFXR2O7B5CLT%2F20260727%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260727T163225Z&X-Amz-Expires=43200&X-Amz-SignedHeaders=host&X-Amz-Signature=25167afd09f464d6098dc1b757a3dbeea4153130a3851d012462011fd2018d58';

const BG = '#0d1b2a';
const CARD = '#1c2e45';
const TEXT_PRIMARY = '#cce0f5';
const DIVIDER = '#3a5a7a';

type InstallState = 'loading' | 'not_installed' | 'installed' | 'update_available' | 'installing';

type Props = {
  app: DashboardModel;
  userEmail: string;
  onBack: () => void;
  onOpenStore: () => void;
};

export default function AppDetailScreen({ app, userEmail, onBack, onOpenStore }: Props) {
  const [installState, setInstallState] = useState<InstallState>('loading');
  const [packageName, setPackageName] = useState<string>('');

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
  }, [app.versionNumber, app.fileName]);

  useEffect(() => {
    checkInstallState(packageName);
  }, [checkInstallState, packageName]);

  const handleInstall = async () => {
    console.log('[Install] Button tapped');
    console.log('[Install] zipURL:', app.zipURL);
    console.log('[Install] fileName:', app.fileName);
    setInstallState('installing');
    try {
      console.log('[Install] Starting download from:', app.zipURL);
      const resolvedPackageName = await AppUsageService.installApp(app.zipURL, app.fileName);
      console.log('[Install] Download & extraction complete');
      if (Platform.OS === 'windows') {
        // Parse paths returned from native module: "downloadPath=...;installPath=..."
        if (resolvedPackageName) {
          const parts: Record<string, string> = {};
          resolvedPackageName.split(';').forEach(p => {
            const idx = p.indexOf('=');
            if (idx > 0) parts[p.slice(0, idx)] = p.slice(idx + 1);
          });
          console.log('[Install] Download path:', parts.downloadPath);
          console.log('[Install] Install path: ', parts.installPath);
          if (parts.installPath) {
            windowsInstalledApps.set(app.fileName, parts.installPath);
          }
        }
        setInstallState('installed');
        return;
      }
      if (resolvedPackageName) {
        setPackageName(resolvedPackageName);
      }
      setTimeout(() => checkInstallState(resolvedPackageName || packageName), 2000);
    } catch (e) {
      console.log('[Install] installApp error:', e);
      checkInstallState(packageName);
    }
  };

  const handleLaunch = async () => {
    if (Platform.OS === 'windows') {
      const exePath = windowsInstalledApps.get(app.fileName);
      console.log('[Launch] exePath:', exePath);
      if (exePath) {
        await AppUsageService.launchApp(exePath, NetworkService.getToken() ?? '', userEmail);
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
    if (installState === 'loading') {
      return <ActivityIndicator color={TEXT_PRIMARY} style={styles.loadingIndicator} />;
    }
    if (installState === 'installing') {
      return (
        <View style={styles.buttonRow}>
          <ActivityIndicator color={TEXT_PRIMARY} style={styles.loadingIndicator} />
          <Text style={[styles.buttonText, styles.installingText]}>Installing...</Text>
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
      <ScrollView style={styles.card} contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator={false}>

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
  cardContent: {
    padding: 16,
    flexGrow: 1,
  },
  loadingIndicator: {
    marginBottom: 24,
  },
  installingText: {
    marginBottom: 24,
    marginLeft: 8,
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
