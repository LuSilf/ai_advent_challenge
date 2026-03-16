# OpenAI-compatible Bun CLI

Simple CLI utility on Bun that sends a prompt to any OpenAI-compatible LLM endpoint and prints the response.

## Setup

1. Install Bun if needed: https://bun.sh
2. Copy env file:

```bash
cp .env.example .env
```

3. Export your real key in shell (or in your OS environment):

```bash
export OPENAI_API_KEY="your_real_key"
```

4. Fill `.env` values:
   - `OPENAI_API_KEY_ENV` (name of env var with key, default `OPENAI_API_KEY`)
   - `OPENAI_MODEL`
   - Optional `OPENAI_BASE_URL` for non-OpenAI providers
   - Optional `OPENAI_API_KEY` to set key directly (without indirection)
   - Optional `OPENAI_SYSTEM_PROMPT` to override built-in default poetic system prompt
   - Optional `OPENAI_TIMEOUT_MS` request timeout in ms (default `30000`)
   - Optional `OPENAI_DEBUG=1` to print endpoint/model/timeout to stderr

## Usage

```bash
bun run src/cli.ts "Explain recursion in one sentence"
```

Or via script:

```bash
bun run start "Explain recursion in one sentence"
```

## Example with OpenAI-compatible local endpoint

```bash
OPENAI_BASE_URL=http://localhost:1234/v1 OPENAI_MODEL=local-model bun run start "Hello"
```
