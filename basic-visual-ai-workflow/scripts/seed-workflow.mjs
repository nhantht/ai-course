#!/usr/bin/env node

import { seedWorkflow } from './lib/n8n.mjs';

try {
  const force = process.argv.includes('--force');
  const result = await seedWorkflow({ force });
  if (!result.seeded) {
    console.log('Use "npm run reseed" to deliberately restore the bundled workflow.');
  }
} catch (error) {
  console.error(`Workflow seeding failed: ${error.message}`);
  process.exitCode = 1;
}
