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

    return { ...data, user };
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
    }
  },

  getUserInfo(): Promise<any> {
    return NetworkService.get('/userinfo');
  },
};

export default AuthService;
