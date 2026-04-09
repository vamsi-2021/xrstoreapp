import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Image, StatusBar } from 'react-native';
import DashboardModel from '../models/DashboardModel';

const XR_LOGO = require('../assets/xr-store-logo.png');

const BG = '#0d1b2a';
const CARD = '#1c2e45';
const TEXT_PRIMARY = '#cce0f5';
const DIVIDER = '#3a5a7a';

type Props = {
  app: DashboardModel;
  onBack: () => void;
  onOpenStore: () => void;
};

export default function AppDetailScreen({ app, onBack, onOpenStore }: Props) {
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
      <ScrollView style={styles.card} contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>

        {/* Banner Image */}
        <Image source={{ uri: app.bannerURL }} style={styles.bannerImage} resizeMode="cover" />

        {/* Title */}
        <Text style={styles.title}>{app.applicationName}</Text>

        {/* Version & Size */}
        <Text style={styles.meta}>Version {app.versionNumber}  ·  {app.fileSize}</Text>

        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.launchButton}>
            <Text style={styles.launchButtonText}>Launch</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.uninstallButton}>
            <Text style={styles.uninstallButtonText}>Uninstall</Text>
          </TouchableOpacity>
        </View>

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
  launchButton: {
    backgroundColor: '#4a8a3a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  launchButtonText: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '500',
  },
  uninstallButton: {
    backgroundColor: '#7a2a20',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  uninstallButtonText: {
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
