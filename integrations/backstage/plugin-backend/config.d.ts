export interface Config {
  /**
   * Offing developer-portal integration.
   * The backend only reads a published `offing.portal.v1` export; it never scans.
   */
  offing?: {
    /**
     * HTTP(S) URL or absolute filesystem path of the portal export JSON
     * produced by `offing export --format portal`.
     */
    portalExportSource: string;
  };
}
