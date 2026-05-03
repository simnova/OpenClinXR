export type RouteManifestEntry = {
  id: string;
  path: `/${string}`;
  label: string;
  description: string;
  capabilityTags: readonly string[];
};

export type RouteManifest = readonly Readonly<RouteManifestEntry>[];

export function createRouteManifest<const TRoute extends RouteManifestEntry>(
  routes: readonly TRoute[],
): readonly Readonly<TRoute>[] {
  const seenPaths = new Set<string>();

  for (const route of routes) {
    if (seenPaths.has(route.path)) {
      throw new Error(`Duplicate route path: ${route.path}`);
    }

    seenPaths.add(route.path);
  }

  return Object.freeze(routes.map((route) => Object.freeze({ ...route })));
}

export function findRouteByPath<TRoute extends RouteManifestEntry>(
  routes: readonly TRoute[],
  path: string,
): Readonly<TRoute> | undefined {
  return routes.find((route) => route.path === path);
}
