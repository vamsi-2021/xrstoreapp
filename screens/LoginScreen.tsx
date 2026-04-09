import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import AuthService from '../services/AuthService';

const BG = '#0d1b2a';
const INPUT_BG = 'rgba(10, 30, 55, 0.8)';
const BORDER = '#3a7bd5';
const BUTTON_BG = '#3a7bd5';
const TEXT = '#e0f0ff';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type User = {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  email: string;
  preferred_username: string;
  roles: string[];
};

type Props = {
  onLogin: (user: User) => void;
};

export default function LoginScreen({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const validateEmail = (value: string): boolean => {
    if (!value.trim()) {
      setEmailError('Email is required.');
      return false;
    }
    if (!EMAIL_REGEX.test(value.trim())) {
      setEmailError('Please enter a valid email address.');
      return false;
    }
    setEmailError('');
    return true;
  };

  const validatePassword = (value: string): boolean => {
    if (!value) {
      setPasswordError('Password is required.');
      return false;
    }
    if (value.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return false;
    }
    setPasswordError('');
    return true;
  };

  const handleLogin = async () => {
    const isEmailValid = validateEmail(username);
    const isPasswordValid = validatePassword(password);
    if (!isEmailValid || !isPasswordValid) return;
    setError('');
    setLoading(true);
    try {
      const { user } = await AuthService.login(username.trim(), password);
      onLogin(user);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={styles.logoWrapper}>
          <Image
            source={require('../assets/xr-store-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Username:</Text>
          <TextInput
            style={[styles.input, emailError ? styles.inputError : null]}
            placeholder="Enter your email"
            placeholderTextColor="rgba(150,190,230,0.5)"
            value={username}
            onChangeText={(v) => { setUsername(v); if (emailError) validateEmail(v); }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          {emailError ? <Text style={styles.fieldErrorText}>{emailError}</Text> : null}

          <Text style={styles.label}>Password:</Text>
          <TextInput
            style={[styles.input, passwordError ? styles.inputError : null]}
            placeholder="Enter your password (min. 8 characters)"
            placeholderTextColor="rgba(150,190,230,0.5)"
            value={password}
            onChangeText={(v) => { setPassword(v); if (passwordError) validatePassword(v); }}
            secureTextEntry
          />
          {passwordError ? <Text style={styles.fieldErrorText}>{passwordError}</Text> : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Login</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  logoWrapper: {
    alignItems: 'center',
    marginBottom: 60,
  },
  logoImage: {
    width: 220,
    height: 80,
  },
  form: {
    width: '100%',
    alignItems: 'center',
  },
  label: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '600',
    alignSelf: 'center',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    backgroundColor: INPUT_BG,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: TEXT,
    fontSize: 15,
    marginBottom: 20,
  },
  inputError: {
    borderColor: '#ff6b6b',
  },
  fieldErrorText: {
    color: '#ff6b6b',
    fontSize: 13,
    alignSelf: 'flex-start',
    marginTop: -14,
    marginBottom: 12,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: BUTTON_BG,
    borderRadius: 8,
    paddingHorizontal: 40,
    paddingVertical: 12,
    marginTop: 4,
    shadowColor: '#3a7bd5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
    minWidth: 120,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
