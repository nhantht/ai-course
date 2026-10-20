import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const workflowPath = path.join(projectRoot, 'workflows', 'text-summarizer.json');

export function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

export function getRuntime() {
  loadLocalEnv();

  const configuredUserFolder = process.env.N8N_USER_FOLDER || '.data';
  const userFolder = path.isAbsolute(configuredUserFolder)
    ? configuredUserFolder
    : path.resolve(projectRoot, configuredUserFolder);
  const n8nStateFolder = path.join(userFolder, '.n8n');
  const markerPath = path.join(n8nStateFolder, 'text-summarizer.seed.json');
  const n8nEntrypoint = path.join(projectRoot, 'node_modules', 'n8n', 'bin', 'n8n');

  return {
    executable: process.execPath,
    n8nEntrypoint,
    markerPath,
    n8nStateFolder,
    userFolder,
    env: {
      ...process.env,
      N8N_USER_FOLDER: userFolder,
      N8N_LISTEN_ADDRESS: process.env.N8N_LISTEN_ADDRESS ?? '127.0.0.1',
      N8N_DIAGNOSTICS_ENABLED: process.env.N8N_DIAGNOSTICS_ENABLED ?? 'false',
      N8N_VERSION_NOTIFICATIONS_ENABLED:
        process.env.N8N_VERSION_NOTIFICATIONS_ENABLED ?? 'false',
      N8N_PERSONALIZATION_ENABLED: process.env.N8N_PERSONALIZATION_ENABLED ?? 'false',
      N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS:
        process.env.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS ?? 'true',
    },
  };
}

export function readWorkflow() {
  return JSON.parse(readFileSync(workflowPath, 'utf8'));
}

export function workflowFingerprint() {
  return createHash('sha256').update(readFileSync(workflowPath)).digest('hex');
}

export function isSeeded(markerPath) {
  if (!existsSync(markerPath)) return false;

  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    return marker.workflowId === readWorkflow().id;
  } catch {
    return false;
  }
}

export function writeSeedMarker(markerPath) {
  mkdirSync(path.dirname(markerPath), { recursive: true });
  const workflow = readWorkflow();
  writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        workflowId: workflow.id,
        sourceFingerprint: workflowFingerprint(),
        seededAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

export function runN8n(args, runtime = getRuntime()) {
  if (!existsSync(runtime.n8nEntrypoint)) {
    throw new Error(
      `n8n is not installed at ${runtime.n8nEntrypoint}. Run \"nvm use\" and \"npm install\" first.`,
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(runtime.executable, [runtime.n8nEntrypoint, ...args], {
      cwd: projectRoot,
      env: runtime.env,
      shell: false,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        resolve({ code: 1, signal });
      } else {
        resolve({ code: code ?? 1, signal: null });
      }
    });
  });
}

export async function seedWorkflow({ force = false } = {}) {
  const runtime = getRuntime();

  if (!existsSync(workflowPath)) {
    throw new Error(`Bundled workflow not found at ${workflowPath}.`);
  }

  if (!force && isSeeded(runtime.markerPath)) {
    console.log('Bundled workflow is already seeded; preserving local student edits.');
    return { seeded: false, runtime };
  }

  console.log(force ? 'Re-seeding bundled workflow…' : 'Seeding bundled workflow…');
  const result = await runN8n(['import:workflow', `--input=${workflowPath}`], runtime);
  if (result.code !== 0) {
    throw new Error(`n8n workflow import failed with exit code ${result.code}.`);
  }

  writeSeedMarker(runtime.markerPath);
  console.log(`Seeded workflow: ${readWorkflow().name}`);
  return { seeded: true, runtime };
}
