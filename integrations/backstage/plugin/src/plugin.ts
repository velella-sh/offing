import {
  createApiFactory,
  createComponentExtension,
  createPlugin,
  discoveryApiRef,
  fetchApiRef,
  configApiRef,
} from "@backstage/core-plugin-api";

import { OffingClient, offingApiRef } from "./api";

export const offingPlugin = createPlugin({
  id: "offing",
  apis: [
    createApiFactory({
      api: offingApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        fetchApi: fetchApiRef,
        configApi: configApiRef,
      },
      factory: ({ discoveryApi, fetchApi }) =>
        new OffingClient({ discoveryApi, fetchApi }),
    }),
  ],
});

/**
 * Entity card that shows lifecycle-risk counts, the next end-of-life date, and a report link
 * for the component's `offing.io/service-path` annotation.
 */
export const EntityOffingLifecycleCard = offingPlugin.provide(
  createComponentExtension({
    name: "EntityOffingLifecycleCard",
    component: {
      lazy: () =>
        import("./components/LifecycleRiskCard").then((m) => m.LifecycleRiskCard),
    },
  }),
);
