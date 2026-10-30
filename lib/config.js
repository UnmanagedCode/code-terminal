import path from 'node:path';

// The backend's settings, from the environment cc gives a plugin backend.
// Without CONDUCTOR_URL or PROJECTS_ROOT the backend runs standalone: it serves
// the UI and health, and every other `api/*` route answers 503 HOST_UNAVAILABLE.
export function loadConfig(env = process.env) {
  const conductorUrl = env.CONDUCTOR_URL || null;
  const projectsRoot = env.PROJECTS_ROOT || null;
  return {
    port: Number(env.PORT ?? 4000),
    conductorUrl: projectsRoot ? conductorUrl : null,
    dataDir: conductorUrl && projectsRoot ? path.join(projectsRoot, '.code-terminal') : null,
  };
}
