const {
  projectConfig: projectConfigWindows,
  dependencyConfig: dependencyConfigWindows,
} = require('@react-native-windows/cli');

module.exports = {
  dependencies: {
    'react-native-device-info': {
      platforms: { windows: null },
    },
    '@react-native-async-storage/async-storage': {
      platforms: { windows: null },
    },
  },
  platforms: {
    windows: {
      npmPackageName: 'react-native-windows',
      projectConfig: projectConfigWindows,
      dependencyConfig: dependencyConfigWindows,
    },
  },
};
