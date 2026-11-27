import { installedDrivers } from "./vendors.js";

export function vendorByName(name: string) {
  return installedDrivers.find((driver) => driver.name === name);
}

export async function listDrivers(): Promise<string[]> {
  const vendors = await Promise.all(
    installedDrivers.map(async (driver) => {
      const version = await driver.version();
      return `${driver.name}\t${version ?? "not installed"}`;
    }),
  );
  return ["command\tuser supplied", "replay\t1", ...vendors];
}
