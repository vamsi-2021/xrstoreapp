import { Linking, NativeModules, Platform } from 'react-native';

const CONFIG_FILE_NAME = 'config.json';

export type AppConfig = {
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
};

const DEFAULT_CONFIG: AppConfig = {
  keycloakUrl: '',
  keycloakRealm: '',
  keycloakClientId: '',
};

const REQUIRED_FIELDS: (keyof AppConfig)[] = ['keycloakUrl', 'keycloakRealm', 'keycloakClientId'];

type RNFSModule = typeof import('@dr.pogodin/react-native-fs');

// @dr.pogodin/react-native-fs resolves its TurboModule eagerly, at import
// time, and throws if the native module isn't linked (e.g. a Windows build
// before autolinking has run, or a Jest test environment). A plain top-level
// `import` would take the whole app down with it, so it's required lazily
// here and the failure is caught - callers see `null` and fall back to
// DEFAULT_CONFIG instead of crashing.
let rnfs: RNFSModule | null | undefined;

function loadRNFS(): RNFSModule | null {
  if (rnfs === undefined) {
    try {
      rnfs = require('@dr.pogodin/react-native-fs') as RNFSModule;
    } catch (err) {
      if (__DEV__) {
        console.warn('[ConfigService] react-native-fs native module is unavailable', err);
      }
      rnfs = null;
    }
  }
  return rnfs;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Android's app-specific external storage needs no runtime permission and is
// still reachable via a file manager / USB, unlike its internal filesDir.
// iOS/Windows just get the platform's standard per-app documents folder.
function getConfigDir(fs: RNFSModule): string {
  return Platform.OS === 'android' ? fs.ExternalDirectoryPath : fs.DocumentDirectoryPath;
}

function getConfigFilePath(): string {
  const fs = loadRNFS();
  if (!fs) return '';
  return `${getConfigDir(fs)}/${CONFIG_FILE_NAME}`;
}

// Never throws: malformed JSON or a non-object body both fall back to
// DEFAULT_CONFIG, and any field that isn't a string is dropped rather than
// failing the whole parse - callers only need to check isConfigured().
function parseConfig(raw: string): AppConfig {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('config.json does not contain a JSON object');
  }
  return {
    keycloakUrl: isNonEmptyString(parsed.keycloakUrl) ? parsed.keycloakUrl.trim() : '',
    keycloakRealm: isNonEmptyString(parsed.keycloakRealm) ? parsed.keycloakRealm.trim() : '',
    keycloakClientId: isNonEmptyString(parsed.keycloakClientId) ? parsed.keycloakClientId.trim() : '',
  };
}

let config: AppConfig = { ...DEFAULT_CONFIG };

const ConfigService = {
  // Reads config.json from the platform's app config directory, creating it
  // with empty defaults on first run. Any failure along the way (unreadable
  // directory, invalid JSON, missing fields, no native module linked yet)
  // is swallowed and leaves `config` at DEFAULT_CONFIG - the app must never
  // crash on startup because of a bad or absent config file.
  async initialize(): Promise<AppConfig> {
    const fs = loadRNFS();
    if (!fs) {
      config = { ...DEFAULT_CONFIG };
      return config;
    }

    try {
      const dir = getConfigDir(fs);
      const dirExists = await fs.exists(dir);
      if (!dirExists) {
        await fs.mkdir(dir);
      }

      const path = `${dir}/${CONFIG_FILE_NAME}`;
      const fileExists = await fs.exists(path);
      if (!fileExists) {
        await fs.writeFile(path, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
        config = { ...DEFAULT_CONFIG };
        return config;
      }

      const raw = await fs.readFile(path, 'utf8');
      config = parseConfig(raw);
    } catch (err) {
      if (__DEV__) {
        console.warn('[ConfigService] Failed to load config.json, falling back to empty config', err);
      }
      config = { ...DEFAULT_CONFIG };
    }
    return config;
  },

  getConfig(): AppConfig {
    return config;
  },

  get KEYCLOAK_URL(): string {
    return config.keycloakUrl;
  },

  get KEYCLOAK_REALM(): string {
    return config.keycloakRealm;
  },

  get KEYCLOAK_CLIENT_ID(): string {
    return config.keycloakClientId;
  },

  isConfigured(): boolean {
    return REQUIRED_FIELDS.every((field) => isNonEmptyString(config[field]));
  },

  getMissingFields(): (keyof AppConfig)[] {
    return REQUIRED_FIELDS.filter((field) => !isNonEmptyString(config[field]));
  },

  getConfigFilePath,

  // Reveals the config directory using whatever mechanism each platform
  // actually supports - there's no single cross-platform "open this folder"
  // API. Errors are swallowed; the caller's alert already shows the reason
  // this was invoked, so a failed reveal isn't fatal.
  async openConfigLocation(): Promise<void> {
    const fs = loadRNFS();
    if (!fs) return;
    const dir = getConfigDir(fs);

    try {
      if (Platform.OS === 'windows') {
        const { InstallModule } = NativeModules;
        if (InstallModule?.openFolder) {
          await InstallModule.openFolder(dir);
        }
        return;
      }

      if (Platform.OS === 'ios') {
        // Opens the Files app to this app's Documents folder. Requires
        // UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace in
        // Info.plist.
        await Linking.openURL('shareddocuments://');
        return;
      }

      if (Platform.OS === 'android') {
        const { AppUsageModule } = NativeModules;
        if (AppUsageModule?.openFolder) {
          await AppUsageModule.openFolder(dir);
        }
        return;
      }
    } catch (err) {
      if (__DEV__) {
        console.warn('[ConfigService] openConfigLocation failed', err);
      }
    }
  },
};

export default ConfigService;
