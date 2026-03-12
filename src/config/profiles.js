const MAX_EXTENDS_DEPTH = 5;

export function resolveProfile(profiles, name) {
  if (!profiles[name]) {
    throw new Error(`Profile "${name}" not found in config`);
  }

  const chain = [];
  let current = name;

  while (current) {
    if (chain.includes(current)) {
      throw new Error(`Circular extends detected: ${chain.join(' -> ')} -> ${current}`);
    }
    if (chain.length > MAX_EXTENDS_DEPTH) {
      throw new Error(`Extends depth exceeds maximum of ${MAX_EXTENDS_DEPTH}`);
    }
    chain.push(current);
    const profile = profiles[current];
    current = profile.extends || null;
    if (current && !profiles[current]) {
      throw new Error(`Profile "${current}" not found (extended by "${chain.at(-1)}")`);
    }
  }

  // Merge from base to most specific
  chain.reverse();
  const merged = {};
  for (const profileName of chain) {
    const profile = profiles[profileName];
    for (const [key, value] of Object.entries(profile)) {
      if (key === 'extends') continue;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        merged[key] = { ...merged[key], ...value };
      } else {
        merged[key] = value;
      }
    }
  }

  return merged;
}
