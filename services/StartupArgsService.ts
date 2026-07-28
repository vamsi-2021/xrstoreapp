import { NativeModules, Platform } from 'react-native';

const { StartupArgsModule } = NativeModules;

export type StartupArguments = {
  token: string;
  email: string;
};

const EMPTY_ARGS: StartupArguments = { token: '', email: '' };

// Bridges to the native StartupArgsModule (windows/ComXrstoreApp/ComXrstoreApp.cpp),
// which parses the -Token=/-Email= command-line arguments this app may have
// been launched with - see AppUsageService.launchApp for the JS side that
// forwards them when this app launches another XR Store app.
//
// Only implemented on Windows. Other platforms, or a Windows build where the
// native module failed to register, resolve to empty values so callers can
// treat "no startup token" uniformly without special-casing the platform.
const StartupArgsService = {
  async getStartupArguments(): Promise<StartupArguments> {
    if (Platform.OS !== 'windows' || !StartupArgsModule) {
      return EMPTY_ARGS;
    }

    try {
      const args = await StartupArgsModule.getStartupArguments();
      return {
        token: typeof args?.token === 'string' ? args.token : '',
        email: typeof args?.email === 'string' ? args.email : '',
      };
    } catch (err) {
      if (__DEV__) {
        // Never log the token itself, only that reading it failed.
        console.warn('[StartupArgsService] Failed to read startup arguments', err);
      }
      return EMPTY_ARGS;
    }
  },
};

export default StartupArgsService;
