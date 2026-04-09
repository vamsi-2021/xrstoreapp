import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, ActivityIndicator, StatusBar } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import AuthService from '../services/AuthService';
import DashboardService from '../services/DashboardService';
import AppUsageService from '../services/AppUsageService';
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
  const [usageTimes, setUsageTimes] = useState<Record<string, string>>({});

  useEffect(() => {
    DashboardService.getApps()
      .then((apps: DashboardModel[]) => {
        setAllApps(apps);
        fetchUsageTimes(apps);
      })
      .catch(() => {})
      .finally(() => setAppsLoading(false));
  }, []);

  const fetchUsageTimes = async (apps: DashboardModel[]) => {
    const times: Record<string, string> = {};
    await Promise.all(
      apps.map(async (app) => {
        const packageName = app.fileName.replace(/\.apk$/i, '');
        try {
          const stats = await AppUsageService.getAppUsage(packageName);
          times[app.fileName] = stats.totalTimeFormatted;
        } catch {
          times[app.fileName] = '00:00';
        }
      })
    );
    setUsageTimes(times);
  };

  useEffect(() => {
    DeviceInfo.getBatteryLevel().then((level) => {
      setBatteryLevel(level >= 0 ? Math.round(level * 100) : 'N/A');
    }).catch(() => setBatteryLevel('N/A'));
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
            <TouchableOpacity style={styles.appItem} onPress={() => onSelectApp(app)} activeOpacity={0.8}>
              {/* Thumbnail */}
              <View style={styles.appThumbnail}>
                <Image source={{ uri: app.logoURL }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              </View>

              {/* Name + Time in App */}
              <View style={styles.appDetails}>
                <Text style={styles.appName}>{app.applicationName}</Text>
                <Text style={styles.appTimeInApp}>Time in App: {usageTimes[app.fileName] ?? '00:00'}</Text>
              </View>
            </TouchableOpacity>
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
    backgroundColor: '#b0bece',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    overflow: 'hidden',
    minHeight: 90,
  },
  appThumbnail: {
    width: 80,
    height: 80,
    backgroundColor: '#8a9eb5',
    borderRadius: 10,
    margin: 10,
    overflow: 'hidden',
  },
  appDetails: {
    flex: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
    gap: 8,
  },
  appName: {
    color: '#1a2d42',
    fontSize: 18,
    fontWeight: '500',
  },
  appTimeInApp: {
    color: '#1a2d42',
    fontSize: 16,
    fontWeight: '400',
  },
});
