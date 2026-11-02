import path from 'node:path';

// The backend's settings, from the environment cc gives a plugin backend.
// - CONDUCTOR_URL set: cc mode. The store is CONDUCTOR_PLUGIN_DATA_DIR, which must be
//   an absolute path; without one this throws, so the backend exits instead of failing on the first terminal.
// - CONDUCTOR_URL unset: standalone. The backend serves the UI and health, and every
//   other `api/*` route answers 503 HOST_UNAVAILABLE.
export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 4000);
  const conductorUrl = env.CONDUCTOR_URL || null;
  if (!conductorUrl) return { port, conductorUrl: null, dataDir: null };
  const dataDir = env.CONDUCTOR_PLUGIN_DATA_DIR;
  if (!dataDir) {
    throw new Error('code-terminal: CONDUCTOR_URL is set but CONDUCTOR_PLUGIN_DATA_DIR is not; this backend needs a cc that provides a plugin data dir');
  }
  if (!path.isAbsolute(dataDir)) {
    throw new Error(`code-terminal: CONDUCTOR_PLUGIN_DATA_DIR must be an absolute path, got ${JSON.stringify(dataDir)}`);
  }
  return { port, conductorUrl, dataDir };
}
