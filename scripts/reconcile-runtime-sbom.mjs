import { packageUrl } from './generate-sbom.mjs';

// A source dependency graph includes browser/build-time branches that need not
// appear as packages in standalone. Require the inverse: every inventoried
// runtime npm package must have its exact identity in that graph.
export function reconcileRuntimePackages(sbom, inventory) {
  if (!Array.isArray(sbom.components) || !Array.isArray(inventory.packages) ||
      inventory.packages.length === 0 || inventory.packageCount !== inventory.packages.length) {
    throw new Error('runtime/SBOM package inventory is empty or inconsistent');
  }
  const source = new Map();
  for (const component of sbom.components.filter((value) => value.type === 'library')) {
    const ref = packageUrl(component.name, component.version);
    if (component.purl !== ref || component['bom-ref'] !== ref || source.has(ref)) {
      throw new Error('source SBOM npm identity is invalid or duplicated');
    }
    source.set(ref, component);
  }
  const matched = new Set();
  for (const entry of inventory.packages) {
    if (typeof entry.name !== 'string' || !entry.name.trim() ||
        typeof entry.version !== 'string' || !entry.version.trim()) {
      throw new Error('runtime package identity is missing');
    }
    const ref = packageUrl(entry.name, entry.version);
    if (matched.has(ref)) throw new Error('runtime package identity is duplicated');
    if (!source.has(ref)) throw new Error(`runtime package missing from source SBOM: ${ref}`);
    matched.add(ref);
  }
  return {
    status: 'PASS',
    scope: 'Exact npm name/version identities from the runtime inventory',
    packages: [...matched].sort(),
    sourceOnlyPackageCount: source.size - matched.size,
    limitations: 'Does not enumerate embedded JS, browser bundles, native subcomponents or the base image.'
  };
}
