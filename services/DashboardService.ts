import NetworkService from './NetworkService';
import DashboardModel from '../models/DashboardModel';

const DASHBOARD_URL = 'https://rkj386iqpa.execute-api.us-east-2.amazonaws.com';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache: { apps: DashboardModel[]; expiresAt: number } | null = null;

const DashboardService = {
  clearCache() {
    cache = null;
  },

  async getApps(): Promise<DashboardModel[]> {
    if (cache && Date.now() < cache.expiresAt) {
      console.log('[DashboardService] Returning cached apps');
      return cache.apps;
    }

    const token = NetworkService.getToken();
    console.log('[DashboardService] GET', DASHBOARD_URL, { accesstoken: token ? '***' : '' });

    const response = await fetch(DASHBOARD_URL, {
      method: 'GET',
      headers: {
        accesstoken: token ?? '',
        Accept: 'application/json',
      },
    });

    let data: any;
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message: string =
        (data && data.message) ||
        (typeof data === 'string' ? data : null) ||
        `Request failed with status ${response.status}`;
      const error: any = new Error(message);
      error.status = response.status;
      console.error('[DashboardService] Error', response.status, message);
      throw error;
    }

    console.log('[DashboardService] Response', response.status, data);
    console.log('[DashboardService] isArray:', Array.isArray(data), '| keys:', typeof data === 'object' ? Object.keys(data) : 'N/A');
    const list = Array.isArray(data) ? data : data.apps ?? [];
    console.log('[DashboardService] List before mapping:', list.length, list);
    const apps = DashboardModel.fromList(list);
    console.log('[DashboardService] Mapped models', apps);
    cache = { apps, expiresAt: Date.now() + CACHE_TTL_MS };
    return apps;
  },
};

export default DashboardService;
