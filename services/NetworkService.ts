import ConfigService from './ConfigService';

// Computed per-call rather than cached at module load: ConfigService.initialize()
// runs asynchronously during app startup, after this module is first imported,
// so a module-level constant would capture empty values.
function getBaseUrl(): string {
  return `${ConfigService.KEYCLOAK_URL}/realms/${ConfigService.KEYCLOAK_REALM}/protocol/openid-connect`;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const NetworkService = {
  // ─── Token Management ────────────────────────────────────────────────────────

  setTokens(access: string, refresh: string): void {
    accessToken = access;
    refreshToken = refresh;
  },

  getToken(): string | null {
    return accessToken;
  },

  getRefreshToken(): string | null {
    return refreshToken;
  },

  clearTokens(): void {
    accessToken = null;
    refreshToken = null;
  },

  // ─── JSON Request ─────────────────────────────────────────────────────────────

  async request(
    method: RequestMethod,
    endpoint: string,
    body: object | null = null,
    requiresAuth: boolean = true,
  ): Promise<any> {
    const url = `${getBaseUrl()}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (requiresAuth && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const options: RequestInit = { method, headers };

    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    return this._send(url, options);
  },

  // ─── Form-Encoded Request ─────────────────────────────────────────────────────

  async postForm(endpoint: string, params: Record<string, string>): Promise<any> {
    const url = `${getBaseUrl()}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    const body = new URLSearchParams(params).toString();

    return this._send(url, { method: 'POST', headers, body });
  },

  // ─── Shared Response Handler ──────────────────────────────────────────────────

  async _send(url: string, options: RequestInit): Promise<any> {
    const response = await fetch(url, options);

    let data: any;
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const message: string =
        (data && (data.error_description || data.message)) ||
        (typeof data === 'string' ? data : null) ||
        `Request failed with status ${response.status}`;
      const error: any = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  },

  // ─── Convenience Methods ──────────────────────────────────────────────────────

  get(endpoint: string, requiresAuth: boolean = true): Promise<any> {
    return this.request('GET', endpoint, null, requiresAuth);
  },

  post(endpoint: string, body: object, requiresAuth: boolean = true): Promise<any> {
    return this.request('POST', endpoint, body, requiresAuth);
  },

  put(endpoint: string, body: object, requiresAuth: boolean = true): Promise<any> {
    return this.request('PUT', endpoint, body, requiresAuth);
  },

  delete(endpoint: string, requiresAuth: boolean = true): Promise<any> {
    return this.request('DELETE', endpoint, null, requiresAuth);
  },
};

export default NetworkService;
