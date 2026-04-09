import React, { useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';
import AppDetailScreen from './screens/AppDetailScreen';
import StoreScreen from './screens/StoreScreen';
import DashboardModel from './models/DashboardModel';

type Screen = 'login' | 'dashboard' | 'store' | 'detail';

type User = {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  email: string;
  preferred_username: string;
  roles: string[];
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [selectedApp, setSelectedApp] = useState<DashboardModel | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const handleLogin = (userInfo: User) => {
    setUser(userInfo);
    setScreen('dashboard');
  };

  const handleLogout = () => {
    setUser(null);
    setScreen('login');
  };

  const handleSelectApp = (app: DashboardModel) => {
    setSelectedApp(app);
    setScreen('detail');
  };

  if (screen === 'login') {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (screen === 'detail' && selectedApp) {
    return (
      <AppDetailScreen
        app={selectedApp}
        onBack={() => setScreen('dashboard')}
        onOpenStore={() => setScreen('store')}
      />
    );
  }

  if (screen === 'store') {
    return (
      <StoreScreen
        onBack={() => setScreen('dashboard')}
        onSelectApp={handleSelectApp}
      />
    );
  }

  return (
    <DashboardScreen
      user={user!}
      onSelectApp={handleSelectApp}
      onOpenStore={() => setScreen('store')}
      onLogout={handleLogout}
    />
  );
}
