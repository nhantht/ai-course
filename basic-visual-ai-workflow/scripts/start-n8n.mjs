#!/usr/bin/env node

import { runN8n, seedWorkflow } from './lib/n8n.mjs';

try {
  const { runtime } = await seedWorkflow();
  const host = runtime.env.N8N_HOST || 'localhost';
  const port = runtime.env.N8N_PORT || '5678';

  console.log(`\nStarting n8n at http://${host}:${port}`);
  console.log('Press Ctrl+C to stop it.\n');

  const result = await runN8n(['start'], runtime);
  if (result.signal) {
    console.log(`n8n stopped by ${result.signal}.`);
  } else {
    process.exitCode = result.code;
  }
} catch (error) {
  console.error(`\nStartup failed: ${error.message}`);
  process.exitCode = 1;
}
