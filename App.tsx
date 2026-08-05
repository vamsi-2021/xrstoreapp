import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';
import AppDetailScreen from './screens/AppDetailScreen';
import StoreScreen from './screens/StoreScreen';
import LocalLibraryScreen from './screens/LocalLibraryScreen';
import DashboardModel from './models/DashboardModel';
import AuthService from './services/AuthService';
import ConfigService from './services/ConfigService';
import StartupArgsService from './services/StartupArgsService';
import SecureStorage from './services/SecureStorage';

type Screen = 'login' | 'dashboard' | 'store' | 'detail' | 'localLibrary' | 'bootstrapping';

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
  const [screen, setScreen] = useState<Screen>('bootstrapping');
  const [selectedApp, setSelectedApp] = useState<DashboardModel | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // Startup auto-login: this app can be launched as
  // `MyApp.exe -Token="..." -Email="..."` (see AppUsageService.launchApp,
  // which does exactly this when this app launches another one from the
  // store). StartupArgsService reads those arguments from the native
  // StartupArgsModule; if a token is present we validate it and skip
  // straight to the dashboard, otherwise we fall back to the normal login
  // screen. Any failure here (missing args, invalid/expired token, no native
  // module on this platform) is swallowed and treated the same as "no
  // token" so the app can never get stuck on the bootstrapping screen.
  //
  // ConfigService.initialize() loads config.json (creating it with empty
  // defaults on first run) before anything Keycloak-related runs. If the
  // config turns out incomplete, auto-login is skipped in favor of the
  // manual login screen, which is where the user is prompted to fix it.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await ConfigService.initialize();

      if (!ConfigService.isConfigured()) {
        if (!cancelled) setScreen('login');
        return;
      }

      const { token } = await StartupArgsService.getStartupArguments();

      if (token) {
        try {
          const { user: startupUser } = await AuthService.loginWithToken(token);
          await SecureStorage.saveToken(token);
          if (!cancelled) {
            setUser(startupUser);
            setScreen('dashboard');
          }
          return;
        } catch (err) {
          if (__DEV__) {
            console.warn('[App] Auto-login failed, falling back to manual login', err);
          }
        }
      }

      if (!cancelled) setScreen('login');
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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

  if (screen === 'bootstrapping') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1b2a' }}>
        <ActivityIndicator color="#3a7bd5" size="large" />
      </View>
    );
  }

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

  if (screen === 'localLibrary') {
    return <LocalLibraryScreen onBack={() => setScreen('dashboard')} />;
  }

  return (
    <DashboardScreen
      user={user!}
      onSelectApp={handleSelectApp}
      onOpenStore={() => setScreen('store')}
      onOpenLocalLibrary={() => setScreen('localLibrary')}
      onLogout={handleLogout}
    />
  );
}
