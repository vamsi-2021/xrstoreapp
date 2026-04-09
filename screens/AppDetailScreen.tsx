import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Image, StatusBar, ActivityIndicator } from 'react-native';
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
  const packageName = app.fileName.replace(/\.apk$/i, '');

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
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.installButton}>
            <Text style={styles.buttonText}>Install</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (installState === 'update_available') {
      return (
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.updateButton}>
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
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
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
