# What Are AI-Powered Workflows?

An AI-powered workflow is a program that follows a developer-defined process and uses an AI model for one or more bounded steps inside that process.

The defining characteristic is **who controls what happens next**. In a workflow, application logic decides:

- which steps exist;
- the order and conditions between them;
- what data each step receives;
- when the model is called;
- how its output is validated or transformed; and
- when processing ends.

The model may summarize, classify, extract, or generate content, but it does not choose the application's next action.

## The Workflow in This Project

The bundled n8n workflow follows this predefined path:

```text
form upload
  -> extract TXT or Markdown content
  -> send a fixed summarization request to OpenAI
  -> show the summary in a completion form
```

The browser form requests one `.txt` or `.md` file. This basic local example intentionally omits server-side upload validation so students can focus on the workflow itself. The OpenAI node performs one predefined text transformation; it has no tools and cannot add, skip, or reorder workflow nodes. The final Form Ending sanitizes and displays the completion message.

This is a visual AI workflow, not an AI agent.

## Deterministic Control Flow

"Deterministic control flow" does not mean every generated word must be identical. Generative models may produce different wording for the same input.

It means the application-defined path is predictable. A workflow may contain branches, loops, retries, and multiple model calls while remaining a workflow, provided those transitions were programmed in advance.

This project has a single linear path. Workflows may also contain predefined branches, loops, and retries while remaining deterministic application control; the model still does not decide which workflow node runs next.

## Workflow Versus AI Agent

An AI agent receives a goal and can select at least part of the execution path. Depending on its design, an agent may choose tools, inspect tool results, revise its approach, repeat actions, or decide when it has enough information.

| Workflow | AI agent |
| --- | --- |
| Follows developer-defined stages | Selects at least some actions dynamically |
| Uses fixed transitions and conditions | May plan or revise its path |
| Calls a model at known points | May choose when and which tools to call |
| Stops at a programmed endpoint | May decide when the goal is complete |
| Easier to predict and test | More flexible but less predictable |

The presence of an AI model alone does not make a system agentic. The OpenAI Responses API can support agents, but this project uses it only inside one fixed summarization step.

Compare this project with `../basic-visual-ai-agent/`. There, an AI Agent node chooses between summarization and PDF-generation tools. Here, every node and transition is fixed before execution begins.

## Why Start With a Workflow?

### Predictability

Students can inspect the data after each node and know which stage runs next.

### Easier Testing and Debugging

Text extraction, model configuration, output handling, and node connections can be checked independently.

### Cost Control

A successful execution makes one known model call instead of entering a model-directed tool loop.

### Safety and Permissions

The model receives document text but no filesystem, web, shell, or workflow tools. Uploaded content is treated as data and cannot select new actions.

### Consistent Rules

File selection guidance, credential handling, and output rendering stay in normal workflow configuration rather than being left to model interpretation.

## Suitable Uses

AI-powered workflows are a good fit for bounded, repeatable tasks such as:

- summarizing uploaded documents;
- classifying messages into known categories;
- extracting predefined fields;
- translating supplied text;
- rewriting content for a fixed audience;
- checking text against a known rubric; and
- processing records through a consistent sequence.

An agent becomes more useful when the goal is clear but the required steps genuinely cannot be known in advance, such as open-ended research or troubleshooting across several possible systems.

## A Practical Rule

Ask:

> Does the model only produce a result inside a predefined step, or does it decide what the application should do next?

In this project, n8n controls every transition. The model produces a summary inside one step, so the system is an AI-powered workflow.
