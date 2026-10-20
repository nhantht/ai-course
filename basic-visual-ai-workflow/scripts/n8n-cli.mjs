#!/usr/bin/env node

import { getRuntime, runN8n } from './lib/n8n.mjs';

try {
  const result = await runN8n(process.argv.slice(2), getRuntime());
  if (result.signal) {
    console.log(`n8n stopped by ${result.signal}.`);
  } else {
    process.exitCode = result.code;
  }
} catch (error) {
  console.error(`n8n CLI failed: ${error.message}`);
  process.exitCode = 1;
}
