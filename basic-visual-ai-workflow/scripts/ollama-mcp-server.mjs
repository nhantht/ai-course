// MCP server (stdio) that exposes a local Ollama model as tools.
// Tools: ask_ollama (free prompt), extract_text (pull text out of a file or pasted text),
//        extract_text_from_image (OCR via a vision model, default moondream).
// Run:   npm run mcp:ollama
// Env:   OLLAMA_HOST, OLLAMA_MODEL (see test-ollama.mjs)
//
// Note: stdout carries the MCP protocol, so log to stderr only.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { askOllama } from './test-ollama.mjs';
import { generateVideoAdPrompt } from './video-ad-prompt.mjs';

const MAX_CHARS = 12000; // ~3k tokens; fits the 4096-token context set in askOllama
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL ?? 'moondream';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TEXT_EXTENSIONS =new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.log']);

const server = new McpServer({ name: 'ollama', version: '1.0.0' });

const textResult = (text, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(isError && { isError: true }),
});

// Forward Ollama progress to the MCP client as notifications/progress (percent out of 100).
// Only sent when the client asked for it by supplying a progressToken.
function progressReporter(extra) {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return undefined;
  let last = -1;
  return ({ phase, percent }) => {
    if (percent === last) return; // skip duplicates; one notification per percent step
    last = percent;
    extra
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress: percent, total: 100, message: phase },
      })
      .catch(() => {}); // progress is best-effort
  };
}

server.registerTool(
  'ask_ollama',
  {
    description: 'Send a prompt to the local Ollama model and return its reply.',
    inputSchema: {
      prompt: z.string().min(1).describe('The prompt to send'),
      model: z.string().optional().describe('Ollama model name (default: auto-picked)'),
    },
  },
  async ({ prompt, model }, extra) => {
    try {
      const { model: used, response, truncated } = await askOllama(prompt, model, {
        onProgress: progressReporter(extra),
      });
      return textResult(`[${used}]\n${response}${truncated ? '\n\n(Reply cut off at the token limit.)' : ''}`);
    } catch (err) {
      return textResult(`Ollama request failed: ${err.message}`, true);
    }
  },
);

server.registerTool(
  'extract_text',
  {
    description:
      'Read a local text/Markdown file (or take pasted text) and use Ollama to extract what is asked for. ' +
      'Defaults to the main points as plain text.',
    inputSchema: {
      file_path: z.string().optional().describe('Path to a .txt/.md/.csv/.json/.log file'),
      text: z.string().optional().describe('Raw text, used when file_path is not given'),
      instruction: z
        .string()
        .optional()
        .describe('What to extract, e.g. "all dates and names" (default: key points)'),
      model: z.string().optional().describe('Ollama model name (default: auto-picked)'),
    },
  },
  async ({ file_path, text, instruction, model }, extra) => {
    try {
      let source = text;
      if (file_path) {
        const ext = path.extname(file_path).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) {
          return textResult(`Unsupported file type "${ext}". Use: ${[...TEXT_EXTENSIONS].join(', ')}`, true);
        }
        source = await readFile(file_path, 'utf8');
      }
      if (!source?.trim()) return textResult('Provide file_path or non-empty text.', true);

      const truncated = source.length > MAX_CHARS;
      const body = truncated ? source.slice(0, MAX_CHARS) : source;
      const task = instruction ?? 'Extract the key points as a short bulleted list.';
      const prompt =
        `${task}\nReply with the extracted text only, no preamble.\n\n--- TEXT START ---\n${body}\n--- TEXT END ---`;

      const { model: used, response, truncated: cutOff } = await askOllama(prompt, model, {
        onProgress: progressReporter(extra),
      });
      const note =
        (truncated ? `\n\n(Input truncated to first ${MAX_CHARS} characters.)` : '') +
        (cutOff ? '\n\n(Reply cut off at the token limit.)' : '');
      return textResult(`[${used}]\n${response}${note}`);
    } catch (err) {
      return textResult(`extract_text failed: ${err.message}`, true);
    }
  },
);

server.registerTool(
  'extract_text_from_image',
  {
    description:
      'Read the text visible in a local image (png/jpg/webp/gif) using an Ollama vision model. ' +
      'Small vision models are approximate; check the result for important text.',
    inputSchema: {
      image_path: z.string().describe('Path to the image file'),
      model: z.string().optional().describe(`Vision model (default: ${VISION_MODEL})`),
    },
  },
  async ({ image_path, model }, extra) => {
    try {
      const ext = path.extname(image_path).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) {
        return textResult(`Unsupported image type "${ext}". Use: ${[...IMAGE_EXTENSIONS].join(', ')}`, true);
      }
      const bytes = await readFile(image_path);
      if (bytes.length > MAX_IMAGE_BYTES) {
        return textResult(`Image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`, true);
      }
      const { model: used, response, truncated } = await askOllama(
        'Transcribe all text visible in this image exactly as written. Reply with the text only. ' +
          'If there is no text, reply "No text found."',
        model ?? VISION_MODEL,
        { images: [bytes.toString('base64')], onProgress: progressReporter(extra) },
      );
      if (!response.trim()) {
        return textResult(
          `[${used}] returned no text. This model may be too small for OCR; try a larger vision model via OLLAMA_VISION_MODEL.`,
          true,
        );
      }
      return textResult(`[${used}]\n${response}${truncated ? '\n\n(Reply cut off at the token limit.)' : ''}`);
    } catch (err) {
      return textResult(`extract_text_from_image failed: ${err.message}`, true);
    }
  },
);

server.registerTool(
  'generate_video_ad_prompt',
  {
    description:
      'Use Ollama to write a scene-by-scene prompt for an AI video generator (Veo, Sora, Runway...) ' +
      'that builds a video advertisement.',
    inputSchema: {
      product: z.string().min(1).describe('Product, service or idea to advertise'),
      audience: z.string().optional().describe('Target audience'),
      tone: z.string().optional().describe('Tone/mood (default: energetic and modern)'),
      duration_seconds: z.number().int().min(4).max(60).optional().describe('Video length (default 15)'),
      aspect_ratio: z.string().optional().describe('e.g. 9:16, 16:9, 1:1 (default 9:16)'),
      key_message: z.string().optional().describe('Main message to convey'),
      call_to_action: z.string().optional().describe('Final call to action'),
      language: z.string().optional().describe('Language of the whole prompt (default Vietnamese)'),
      model: z.string().optional().describe('Ollama model name (default: auto-picked)'),
    },
  },
  async ({ duration_seconds, aspect_ratio, key_message, call_to_action, model, ...brief }, extra) => {
    try {
      const { model: used, prompt, truncated } = await generateVideoAdPrompt(
        {
          ...brief,
          durationSeconds: duration_seconds,
          aspectRatio: aspect_ratio,
          keyMessage: key_message,
          callToAction: call_to_action,
        },
        { model, onProgress: progressReporter(extra) },
      );
      return textResult(`[${used}]\n${prompt}${truncated ? '\n\n(Reply cut off at the token limit.)' : ''}`);
    } catch (err) {
      return textResult(`generate_video_ad_prompt failed: ${err.message}`, true);
    }
  },
);

await server.connect(new StdioServerTransport());
console.error('ollama MCP server running on stdio');
