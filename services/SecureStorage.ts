import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_TOKEN_KEY = 'xrstore.auth.accessToken';

// The project's only persistence dependency today is AsyncStorage (already
// in package.json but previously unused - tokens only ever lived in memory
// on NetworkService). This wrapper is the one place that reads/writes the
// persisted token, so swapping in real OS-backed secure storage later (e.g.
// react-native-keychain) only means changing this file, not its callers.
const SecureStorage = {
  async saveToken(token: string): Promise<void> {
    await AsyncStorage.setItem(ACCESS_TOKEN_KEY, token);
  },

  async getToken(): Promise<string | null> {
    return AsyncStorage.getItem(ACCESS_TOKEN_KEY);
  },

  async clearToken(): Promise<void> {
    await AsyncStorage.removeItem(ACCESS_TOKEN_KEY);
  },
};

export default SecureStorage;
