import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  Image,
  StatusBar,
} from 'react-native';
import DashboardModel from '../models/DashboardModel';
import data from '../data/sampleData.json';

const XR_LOGO = require('../assets/xr-store-logo.png');

const BG = '#0d1b2a';
const CARD = '#1c2e45';
const ITEM = '#8fa8c0';
const TEXT_PRIMARY = '#cce0f5';

type Props = {
  onSelectApp: (app: DashboardModel) => void;
  onBack: () => void;
};

export default function StoreScreen({ onSelectApp, onBack }: Props) {
  const [search, setSearch] = useState('');

  const filtered = data.apps
    .filter((app) => app.ApplicationName.toLowerCase().includes(search.toLowerCase()))
    .map((app) => new DashboardModel(app));

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Header */}
      <View style={styles.header}>
        <Image source={XR_LOGO} style={styles.logoImage} resizeMode="contain" />
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor="#8fa8c0"
          value={search}
          onChangeText={setSearch}
        />
        <Text style={styles.searchIcon}>🔍</Text>
      </View>

      {/* App List */}
      <FlatList
        data={filtered}
        keyExtractor={(app) => app.fileName}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: app }) => (
          <View style={styles.appItem}>
            <View style={styles.appThumbnail}>
              <Image source={{ uri: app.logoURL }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            </View>
            <View style={styles.appInfo}>
              <Text style={styles.appName}>{app.applicationName}</Text>
              <TouchableOpacity style={styles.launchButton} onPress={() => onSelectApp(app)}>
                <Text style={styles.launchButtonText}>View</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
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
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a4a6a',
  },
  searchInput: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontSize: 16,
  },
  searchIcon: {
    fontSize: 18,
  },
  appItem: {
    backgroundColor: ITEM,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 14,
  },
  appThumbnail: {
    width: 70,
    height: 80,
    backgroundColor: '#b0c4d8',
    borderRadius: 10,
    marginRight: 16,
    overflow: 'hidden',
  },
  appInfo: {
    flex: 1,
    gap: 10,
  },
  appName: {
    color: '#1a2e45',
    fontSize: 18,
    fontWeight: '700',
  },
  launchButton: {
    backgroundColor: '#1c3a5c',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  launchButtonText: {
    color: TEXT_PRIMARY,
    fontSize: 15,
  },
});
