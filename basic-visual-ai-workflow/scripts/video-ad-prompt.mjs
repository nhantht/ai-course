// Ask a local Ollama model to write a prompt for building a video advertisement.
// Usage: npm run video-ad -- "Product / idea" [model]
// Env:   OLLAMA_HOST, OLLAMA_MODEL (default here: qwen3:8b; run `ollama pull qwen3:8b` once)

import { pathToFileURL } from 'node:url';
import { askOllama } from './test-ollama.mjs';

const DEFAULT_MODEL = 'qwen3:8b'; // best Vietnamese among small local models; override with OLLAMA_MODEL
const VIDEO_AD_MAX_TOKENS = 1024; // a multi-scene prompt needs more room than the 512 default

const SYSTEM_BRIEF =
  'You are a senior advertising creative director who writes prompts for AI video generators ' +
  '(Veo, Sora, Runway, Kling). Write vivid, concrete, visual prompts: subject, setting, camera ' +
  'movement, lighting, mood, pacing. Never invent claims, prices, or statistics that were not given.';

// Build the instruction sent to Ollama from a structured brief.
export function buildVideoAdInstruction({
  product,
  audience,
  tone = 'energetic and modern',
  durationSeconds = 15,
  aspectRatio = '9:16',
  keyMessage,
  callToAction,
  language = 'Vietnamese',
}) {
  if (!product?.trim()) throw new Error('product is required');
  const scenes = Math.max(2, Math.min(6, Math.round(durationSeconds / 4)));
  const lines = [
    SYSTEM_BRIEF,
    '',
    'Write ONE video-generation prompt for the advertisement below.',
    `- Product / idea: ${product}`,
    audience && `- Target audience: ${audience}`,
    `- Tone: ${tone}`,
    `- Length: ${durationSeconds} seconds, ${aspectRatio}`,
    keyMessage && `- Key message: ${keyMessage}`,
    callToAction && `- Call to action (final shot): ${callToAction}`,
    '',
    'Format the reply exactly like this, with no preamble or commentary:',
    'OVERVIEW: <one sentence describing the whole ad>',
    'STYLE: <visual style, color palette, lighting, music mood>',
    ...Array.from({ length: scenes }, (_, i) => `SCENE ${i + 1} (<start>-<end>s): <visuals, camera, action, on-screen text or voice-over>`),
    '',
    `Write everything after the labels (OVERVIEW, STYLE, SCENE) in ${language}, including visuals, on-screen text and voice-over. Keep the labels themselves in English.`,
  ];
  return lines.filter((l) => typeof l === 'string').join('\n');
}

// brief: string (just the product) or an object accepted by buildVideoAdInstruction.
export async function generateVideoAdPrompt(
  brief,
  { model = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL, onProgress, maxTokens = VIDEO_AD_MAX_TOKENS } = {},
) {
  const fields = typeof brief === 'string' ? { product: brief } : brief;
  // "/no_think" is Qwen3's soft switch: skip the reasoning phase so it doesn't eat the token budget.
  const instruction = `${buildVideoAdInstruction(fields)}\n/no_think`;
  let result;
  try {
    result = await askOllama(instruction, model, { onProgress, maxTokens });
  } catch (err) {
    if (/HTTP 404/.test(err.message)) err.message += `\nModel not installed. Run: ollama pull ${model}`;
    throw err;
  }
  const { model: used, response, truncated } = result;
  const prompt = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!prompt) throw new Error(`Model "${used}" returned an empty reply`);
  return { model: used, prompt, truncated };
}

// Run directly from the command line.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const product = process.argv[2];
  if (!product) {
    console.error('Usage: npm run video-ad -- "Product / idea" [model]');
    process.exit(1);
  }
  // Live progress bar on stderr, rewritten in place (only when attached to a terminal).
  // Ollama reports no load progress, so the bar stays at 0% while the model loads, then
  // tracks tokens generated vs. the token cap and jumps to 100% when the reply ends.
  const showProgress = process.stderr.isTTY || process.stdout.isTTY; // npm may pipe one of them
  const start = Date.now();
  let state = { phase: 'loading', percent: 0 };
  const draw = () => {
    const { phase, percent } = state;
    const filled = Math.round(percent / 5);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    const secs = ((Date.now() - start) / 1000).toFixed(0);
    const label = phase === 'loading' ? 'loading model / waiting' : phase === 'done' ? 'done' : 'generating';
    process.stderr.write(`\r\x1b[K${bar} ${String(percent).padStart(3)}% ${label}... ${secs}s`);
  };
  // Redraw on a timer so the elapsed seconds keep ticking while the model loads.
  const ticker = showProgress ? setInterval(draw, 250) : undefined;
  const stopProgress = () => {
    if (!ticker) return;
    clearInterval(ticker);
    process.stderr.write('\r\x1b[K');
  };
  if (showProgress) draw();
  try {
    const { model, prompt, truncated } = await generateVideoAdPrompt(product, {
      model: process.argv[3],
      onProgress: (s) => (state = s),
    });
    stopProgress();
    console.log(`[${model}]\n${prompt}`);
    if (truncated) console.log(`\n(reply cut off at ${VIDEO_AD_MAX_TOKENS} tokens)`);
  } catch (err) {
    stopProgress();
    console.error(`generateVideoAdPrompt failed: ${err.message}`);
    process.exit(1);
  }
}
