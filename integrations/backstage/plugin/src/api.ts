import {
  createApiRef,
  type ConfigApi,
  type DiscoveryApi,
  type FetchApi,
} from "@backstage/core-plugin-api";

import type { PortalCatalog, PortalService } from "@offing-dev/backstage-plugin-common";

export const offingApiRef = createApiRef<OffingApi>({
  id: "plugin.offing.service",
});

export interface OffingApi {
  getCatalog(): Promise<PortalCatalog>;
  getService(servicePath: string): Promise<PortalService>;
}

export class OffingClient implements OffingApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchApi: FetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi; configApi?: ConfigApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  private async baseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl("offing");
  }

  async getCatalog(): Promise<PortalCatalog> {
    const response = await this.fetchApi.fetch(`${await this.baseUrl()}/catalog`);
    if (!response.ok) {
      throw new Error(`Offing catalog request failed: HTTP ${response.status}`);
    }
    return (await response.json()) as PortalCatalog;
  }

  async getService(servicePath: string): Promise<PortalService> {
    const url = new URL(`${await this.baseUrl()}/services`);
    url.searchParams.set("path", servicePath);
    const response = await this.fetchApi.fetch(url.toString());
    if (response.status === 404) {
      throw new Error(`No Offing portal service matches ${servicePath}`);
    }
    if (!response.ok) {
      throw new Error(`Offing service request failed: HTTP ${response.status}`);
    }
    return (await response.json()) as PortalService;
  }
}
