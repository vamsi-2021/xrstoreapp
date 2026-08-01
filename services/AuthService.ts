import NetworkService from './NetworkService';

const CLIENT_ID = 'user_client';
const SCOPE = 'lrs:statements/write openid profile email lrs:statements/read/mine';

type JWTClaims = {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  email: string;
  preferred_username: string;
  realm_access?: { roles: string[] };
};

export type AuthUser = {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  email: string;
  preferred_username: string;
  roles: string[];
};

function parseJWT(token: string): JWTClaims | null {
  try {
    const payload = token.split('.')[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as JWTClaims;
  } catch {
    return null;
  }
}

// Mirrors NetworkService's in-memory token storage: the last user resolved by
// login()/loginWithToken(), so callers elsewhere (e.g. AppUsageService,
// forwarding credentials to a launched app) can read the current session's
// email without App.tsx having to thread it through as a prop.
let currentUser: AuthUser | null = null;

const AuthService = {
  async login(username: string, password: string): Promise<{ user: AuthUser }> {
    const data = await NetworkService.postForm('/token', {
      client_id: CLIENT_ID,
      username,
      password,
      grant_type: 'password',
      scope: SCOPE,
    });

    NetworkService.setTokens(data.access_token, data.refresh_token);

    const claims = parseJWT(data.access_token);
    const user: AuthUser = claims
      ? {
          sub: claims.sub,
          name: claims.name,
          given_name: claims.given_name,
          family_name: claims.family_name,
          email: claims.email,
          preferred_username: claims.preferred_username,
          roles: claims.realm_access?.roles ?? [],
        }
      : { sub: '', name: '', email: '', preferred_username: '', roles: [] };

    currentUser = user;
    return { ...data, user };
  },

  // Used for auto-login when the app is launched with -Token= (see
  // StartupArgsService + App.tsx). Reuses the same NetworkService/JWT
  // plumbing as login() instead of a separate code path: the token is set on
  // NetworkService, then getUserInfo() is used purely to confirm the auth
  // server still accepts it (throws on an invalid/expired token). The user
  // object itself is decoded from the token's own claims, same as login().
  async loginWithToken(token: string): Promise<{ user: AuthUser }> {
    const previousAccessToken = NetworkService.getToken();
    const previousRefreshToken = NetworkService.getRefreshToken();

    NetworkService.setTokens(token, previousRefreshToken ?? '');

    try {
      await this.getUserInfo();
    } catch (err) {
      NetworkService.setTokens(previousAccessToken ?? '', previousRefreshToken ?? '');
      if (!previousAccessToken) NetworkService.clearTokens();
      throw err;
    }

    const claims = parseJWT(token);
    if (!claims) {
      NetworkService.setTokens(previousAccessToken ?? '', previousRefreshToken ?? '');
      if (!previousAccessToken) NetworkService.clearTokens();
      throw new Error('Startup token is malformed.');
    }

    const user: AuthUser = {
      sub: claims.sub,
      name: claims.name,
      given_name: claims.given_name,
      family_name: claims.family_name,
      email: claims.email,
      preferred_username: claims.preferred_username,
      roles: claims.realm_access?.roles ?? [],
    };

    currentUser = user;
    return { user };
  },

  async logout(): Promise<void> {
    const refreshToken = NetworkService.getRefreshToken();
    try {
      if (refreshToken) {
        await NetworkService.postForm('/logout', {
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        });
      }
    } finally {
      NetworkService.clearTokens();
      currentUser = null;
    }
  },

  getUserInfo(): Promise<any> {
    return NetworkService.get('/userinfo');
  },

  // The signed-in user's claims, decoded at login/loginWithToken time. Null
  // if nobody's logged in yet (or logout() has cleared the session).
  getCurrentUser(): AuthUser | null {
    return currentUser;
  },
};

export default AuthService;
