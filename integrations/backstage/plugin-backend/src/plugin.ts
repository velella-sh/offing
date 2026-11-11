import {
  coreServices,
  createBackendPlugin,
} from "@backstage/backend-plugin-api";

import { createRouter } from "./router";

/**
 * Backend plugin that exposes the Offing portal export to the frontend card.
 * Reads a published `offing.portal.v1` JSON file or URL. Never scans a repository.
 */
export const offingPlugin = createBackendPlugin({
  pluginId: "offing",
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
      },
      async init({ httpRouter, logger, config }) {
        const portalExportSource = config.getString("offing.portalExportSource");
        httpRouter.use(
          await createRouter({
            logger,
            portalExportSource,
          }),
        );
        httpRouter.addAuthPolicy({
          path: "/health",
          allow: "unauthenticated",
        });
        logger.info(`Offing portal export source: ${portalExportSource}`);
      },
    });
  },
});
