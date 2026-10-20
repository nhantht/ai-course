// Send a text prompt to a local Ollama server and print the reply.
// Usage: npm run test:ollama -- "Your text here" [model]
// Env:   OLLAMA_HOST (default http://localhost:11434), OLLAMA_MODEL, OLLAMA_MAX_TOKENS (default 512)

import { pathToFileURL } from 'node:url';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const MAX_TOKENS = Number(process.env.OLLAMA_MAX_TOKENS) || 512; // reply cap; also the 100% mark for progress

async function pickModel() {
  if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
  const res = await fetch(`${OLLAMA_HOST}/api/tags`);
  if (!res.ok) throw new Error(`Could not list models: HTTP ${res.status}`);
  const { models } = await res.json();
  if (!models?.length) throw new Error('No models installed. Run: ollama pull llama3.2');
  // Prefer a small model: big ones (e.g. 18 GB qwen3-coder) take ~45s just to load.
  return (models.find((m) => m.name.startsWith('llama3.2')) ?? models[0]).name;
}

// onProgress({ phase, percent, tokens }) is called while waiting. Ollama does not report load
// progress, so percent is only meaningful while generating: tokens so far / maxTokens cap.
// images: optional base64 strings, for vision models (e.g. moondream).
export async function askOllama(text, model, { onProgress, maxTokens = MAX_TOKENS, images } = {}) {
  model ??= await pickModel();
  onProgress?.({ phase: 'loading', percent: 0, tokens: 0 });
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: text, ...(images && { images }) }],
      stream: true,
      keep_alive: '30m', // stay loaded between runs (default unloads after 5 min)
      options: { num_ctx: 4096, num_predict: maxTokens }, // small context to keep memory use low
    }),
  });
  if (!res.ok) throw new Error(`Ollama error HTTP ${res.status}: ${await res.text()}`);

  const decoder = new TextDecoder();
  let buffer = '';
  let response = '';
  let tokens = 0;
  let truncated = false;
  const handle = (line) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (chunk.error) throw new Error(chunk.error);
    response += chunk.message?.content ?? '';
    if (chunk.done) {
      truncated = chunk.done_reason === 'length';
      return;
    }
    tokens += 1;
    onProgress?.({ phase: 'generating', percent: Math.min(99, Math.round((tokens / maxTokens) * 100)), tokens });
  };
  for await (const part of res.body) {
    buffer += decoder.decode(part, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(handle);
  }
  handle(buffer);
  onProgress?.({ phase: 'done', percent: 100, tokens });
  return { model, response, truncated };
}

// Run directly from the command line.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = process.argv[2] ?? 'Say hello in one short sentence.';
  const model = process.argv[3];
  try {
    const stamp = () => new Date().toLocaleTimeString('en-GB');
    const start = Date.now();
    console.log(`[${stamp()}] > ${text}`);
    // Live progress on stderr, rewritten in place (only when attached to a terminal).
    const showProgress = process.stderr.isTTY;
    const onProgress = ({ phase, percent }) => {
      if (!showProgress) return;
      const secs = ((Date.now() - start) / 1000).toFixed(0);
      const label = phase === 'loading' ? 'loading model / waiting' : 'generating';
      process.stderr.write(`\r\x1b[K[${String(percent).padStart(3)}%] ${label}... ${secs}s`);
    };
    const { model: used, response, truncated } = await askOllama(text, model, { onProgress });
    if (showProgress) process.stderr.write('\r\x1b[K');
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${stamp()}] [${used}] (${secs}s) ${response}`);
    if (truncated) console.log(`(reply cut off at ${MAX_TOKENS} tokens; raise OLLAMA_MAX_TOKENS)`);
  } catch (err) {
    console.error(`Failed to reach Ollama at ${OLLAMA_HOST}: ${err.message}`);
    process.exit(1);
  }
}
