const config = {
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native(-macos)?|@react-native(-community)?|@office-iss/react-native-win32|@?react-native-windows|@dr\\.pogodin)/)',
  ],
};

module.exports = require('@rnx-kit/jest-preset')('windows', config);
