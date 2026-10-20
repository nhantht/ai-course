#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, readWorkflow } from './lib/n8n.mjs';

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const relativePath of [
  '.nvmrc',
  'README.md',
  'scripts/n8n-cli.mjs',
  'workflows/text-summarizer.json',
  'samples/lecture-notes.md',
]) {
  assert(existsSync(path.join(projectRoot, relativePath)), `Missing ${relativePath}`);
}

const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
assert(packageJson.private === true, 'package.json must remain private');
assert(packageJson.dependencies?.n8n === '2.32.5', 'n8n must be pinned to 2.32.5');
assert(packageJson.engines?.node === '>=22.22 <25', 'Node engine range is not pinned as expected');
assert(
  packageJson.scripts?.n8n === 'node scripts/n8n-cli.mjs',
  'Arbitrary n8n CLI commands must use the isolated-state wrapper',
);

const runtimeSource = readFileSync(path.join(projectRoot, 'scripts/lib/n8n.mjs'), 'utf8');
assert(
  runtimeSource.includes("N8N_LISTEN_ADDRESS: process.env.N8N_LISTEN_ADDRESS ?? '127.0.0.1'"),
  'Runtime must bind to loopback by default',
);
assert(runtimeSource.includes('shell: false'), 'n8n process launch must not use a shell');

const workflow = readWorkflow();
assert(typeof workflow.id === 'string' && workflow.id.length > 0, 'Workflow needs a stable ID');
assert(workflow.active === false, 'Bundled workflow must be an unpublished draft');
assert(Array.isArray(workflow.nodes) && workflow.nodes.length === 4, 'Workflow must stay at four nodes');
assert(workflow.connections && typeof workflow.connections === 'object', 'Workflow needs connections');

const nodeNames = new Set();
const nodeIds = new Set();
for (const node of workflow.nodes || []) {
  assert(!nodeNames.has(node.name), `Duplicate node name: ${node.name}`);
  assert(!nodeIds.has(node.id), `Duplicate node ID: ${node.id}`);
  nodeNames.add(node.name);
  nodeIds.add(node.id);
  assert(!node.credentials, `Bundled node must not reference credentials: ${node.name}`);
}

const expectedTypes = [
  'n8n-nodes-base.formTrigger',
  'n8n-nodes-base.extractFromFile',
  '@n8n/n8n-nodes-langchain.openAi',
  'n8n-nodes-base.form',
];
for (const type of expectedTypes) {
  assert(workflow.nodes.some((node) => node.type === type), `Missing node type: ${type}`);
}
assert(
  !workflow.nodes.some((node) => node.type === 'n8n-nodes-base.code'),
  'Basic workflow must not contain Code nodes',
);

const openAiModel = workflow.nodes.find(
  (node) => node.type === '@n8n/n8n-nodes-langchain.openAi',
);
assert(openAiModel?.typeVersion === 2.3, 'OpenAI node must use the current v2.3 schema');
assert(openAiModel?.parameters?.resource === 'text', 'OpenAI node must use the Text resource');
assert(
  openAiModel?.parameters?.operation === 'response',
  'OpenAI node must call the Responses API through Message a Model',
);
assert(
  openAiModel?.parameters?.modelId?.value === 'gpt-5.5',
  'OpenAI node must use the tested gpt-5.5 default',
);

for (const [source, connectionGroups] of Object.entries(workflow.connections || {})) {
  assert(nodeNames.has(source), `Connection source does not exist: ${source}`);
  for (const outputs of Object.values(connectionGroups)) {
    for (const output of outputs || []) {
      for (const connection of output || []) {
        assert(nodeNames.has(connection.node), `Connection target does not exist: ${connection.node}`);
      }
    }
  }
}

const trigger = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.formTrigger');
const fields = trigger?.parameters?.formFields?.values || [];
const upload = fields.find((field) => field.fieldType === 'file');
assert(upload, 'Form Trigger needs a file field');
assert(upload?.fieldName === 'document', 'File field must use the stable name "document"');
assert(upload?.acceptFileTypes?.includes('.txt'), 'File field must accept .txt');
assert(upload?.acceptFileTypes?.includes('.md'), 'File field must accept .md');
assert(upload?.requiredField === true, 'File field must be required');

const extractNode = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.extractFromFile');
assert(extractNode?.parameters?.operation === 'text', 'Extract node must read text files');
assert(
  extractNode?.parameters?.binaryPropertyName === 'document',
  'Extract node must read the uploaded document field',
);
assert(
  extractNode?.parameters?.destinationKey === 'content',
  'Extract node must expose document text as content',
);
assert(
  extractNode?.parameters?.options?.keepSource === undefined,
  'Extract node must not forward unused form metadata',
);

const completionNode = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.form');
assert(
  completionNode?.parameters?.respondWith === 'text',
  'Summary must use the sanitized completion screen',
);
assert(
  completionNode?.parameters?.completionMessage === '={{ $json.output[0].content[0].text }}',
  'Completion screen must map the simplified OpenAI text directly',
);

const serializedWorkflow = JSON.stringify(workflow).toLowerCase();
for (const secretMarker of ['sk-proj-', 'api_key=', 'authorization: bearer']) {
  assert(!serializedWorkflow.includes(secretMarker), `Possible embedded secret: ${secretMarker}`);
}

if (failures.length > 0) {
  console.error('Project validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${workflow.nodes.length} workflow nodes, connections, runtime pins, and secret hygiene.`);
}
