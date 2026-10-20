# Basic visual AI workflow

A fixed n8n workflow that accepts a TXT or Markdown upload, summarizes it with OpenAI, and returns the result. Unlike an agent, the model does not choose the execution path.

## Run

```bash
nvm use
npm ci
npm start
```

Open the printed n8n URL, configure your OpenAI credential, and use a file from `samples/`. Run `npm test` to validate the workflow.
