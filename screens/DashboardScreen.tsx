import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, ActivityIndicator, StatusBar } from 'react-native';
import AuthService from '../services/AuthService';
import DashboardService from '../services/DashboardService';
import DashboardModel from '../models/DashboardModel';

const XR_LOGO = require('../assets/xr-store-logo.png');

const BG = '#0d1b2a';
const CARD = '#1c2e45';
const TEXT_PRIMARY = '#cce0f5';

type User = {
  name: string;
  email?: string;
  preferred_username?: string;
};

type Props = {
  user: User;
  onSelectApp: (app: DashboardModel) => void;
  onOpenStore: () => void;
  onLogout: () => void;
};

export default function DashboardScreen({ user, onSelectApp, onOpenStore, onLogout }: Props) {
  const [batteryLevel, setBatteryLevel] = useState<number | string | null>(null);
  const [allApps, setAllApps] = useState<DashboardModel[]>([]);
  const [appsLoading, setAppsLoading] = useState<boolean>(true);

  useEffect(() => {
    DashboardService.getApps()
      .then((apps: DashboardModel[]) => setAllApps(apps))
      .catch(() => {})
      .finally(() => setAppsLoading(false));
  }, []);

  useEffect(() => {
    setBatteryLevel('N/A');
  }, []);

  const handleLogout = async () => {
    await AuthService.logout();
    onLogout();
  };

  const batteryDisplay =
    batteryLevel === null ? '...' : batteryLevel === 'N/A' ? 'N/A' : `${batteryLevel}%`;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onOpenStore}>
          <Image source={XR_LOGO} style={styles.logoImage} resizeMode="contain" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={handleLogout}>
          <Text style={styles.backButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* User Info Card */}
      <View style={styles.userCard}>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user.name}</Text>
          <Text style={styles.batteryText}>Battery {batteryDisplay}</Text>
        </View>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>Currently{'\n'}Online</Text>
        </View>
      </View>

      {/* Installed Apps */}
      <View style={styles.appsCard}>
        <Text style={styles.appsTitle}>My Applications</Text>
        {appsLoading && (
          <ActivityIndicator size="large" color={TEXT_PRIMARY} style={{ marginVertical: 20 }} />
        )}
        <FlatList
          data={allApps}
          keyExtractor={(app) => app.fileName}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          style={{ flex: 1 }}
          onLayout={() => console.log('[DashboardScreen] FlatList rendered, total items:', allApps.length)}
          renderItem={({ item: app, index }) => {
            console.log(`[DashboardScreen] Rendering item ${index}:`, app.applicationName);
            return (
            <View style={styles.appItem}>
              {/* Thumbnail */}
              <View style={styles.appThumbnail}>
                <Image source={{ uri: app.logoURL }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              </View>

              {/* Middle: name + version */}
              <TouchableOpacity style={styles.appDetails} onPress={() => onSelectApp(app)}>
                <Text style={styles.appName}>{app.applicationName}</Text>
                <View style={styles.versionRow}>
                  <Text style={styles.appVersion}>Version {app.versionNumber}</Text>
                </View>
              </TouchableOpacity>

              {/* Right: action buttons */}
              <View style={styles.appActions}>
                <TouchableOpacity style={styles.btnLaunch}>
                  <Text style={styles.btnText}>Launch</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnUninstall}>
                  <Text style={styles.btnText}>Uninstall</Text>
                </TouchableOpacity>
              </View>
            </View>
            );
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 50,
    paddingHorizontal: 16,
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
  userCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  userInfo: {
    gap: 6,
  },
  userName: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '400',
  },
  batteryText: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '400',
  },
  statusBadge: {
    backgroundColor: '#2a4060',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statusText: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  appsCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    flex: 1,
  },
  appsTitle: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '400',
    marginBottom: 14,
  },
  appItem: {
    backgroundColor: '#1c3a52',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    overflow: 'hidden',
    minHeight: 120,
  },
  appThumbnail: {
    width: 120,
    height: 120,
    backgroundColor: '#6e8aaa',
    overflow: 'hidden',
  },
  appDetails: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
    gap: 4,
  },
  appName: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '600',
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appVersion: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    opacity: 0.8,
  },
  appActions: {
    justifyContent: 'center',
    paddingVertical: 12,
    paddingRight: 12,
    paddingLeft: 6,
    gap: 10,
  },
  btnLaunch: {
    backgroundColor: '#4a8a3a',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: 'center',
  },
  btnUninstall: {
    backgroundColor: '#7a2a20',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: 'center',
  },
  btnText: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '500',
  },
});
