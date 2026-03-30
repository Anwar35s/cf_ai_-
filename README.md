# AI Research Agent

A full-stack AI-powered research agent built on Cloudflare's developer platform. Given any research question, it autonomously breaks the question down, searches the web, summarises the results, and writes a structured report — all powered by Llama 3.3 running on Cloudflare's edge.

**Live demo:** https://cf-ai-9jr.pages.dev  
**Worker API:** https://research-agent.anwarsayid62.workers.dev

---

## What it does

Type any research question into the chat UI. The agent runs a 4-step pipeline:

1. **Decompose** — Llama 3.3 breaks your question into 3 focused sub-queries
2. **Search** — each sub-query is sent to the Brave Search API to fetch real web results
3. **Summarise** — Llama 3.3 summarises each set of results independently
4. **Synthesise** — all summaries are combined into a final structured markdown report

The app remembers your past research sessions so you can revisit previous reports.

---

## Architecture

| Component | Cloudflare Product | Purpose |
|---|---|---|
| Chat UI | **Pages** | Frontend served globally from the edge |
| API routing | **Workers** | Stateless HTTP router, starts workflows |
| Research pipeline | **Workflows** | Durable 4-step pipeline with auto-retry |
| LLM inference | **Workers AI** (Llama 3.3) | Decompose, summarise, synthesise |
| Session memory | **Durable Objects** | Persistent per-user research history |
| Web search | **Brave Search API** | Real-time web results for each sub-query |

### How a request flows

```
Browser → API Worker → Workflow (4 steps) → Durable Object (save)
                ↑                                      ↓
           polls every 2s ←————— returns report ———————
```

The Worker is stateless and fast — it just starts the Workflow and returns an ID. The browser polls for the result. When complete, the report is saved to a Durable Object keyed by session ID, so history persists across visits.

---

## Project structure

```
cf_ai_-/
├── wrangler.toml        # Cloudflare bindings (AI, Workflows, Durable Objects)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts         # API Worker — routes /research and /memory requests
│   ├── workflow.ts      # Cloudflare Workflow — 4-step research pipeline
│   └── memory.ts        # Durable Object — session memory and history
└── public/
    └── index.html       # Chat UI — polls workflow, renders report
```

---

## Running locally

### Prerequisites
- Node.js 18+
- A [Brave Search API key](https://api.search.brave.com) (free tier works)
- A Cloudflare account

### Setup

```bash
git clone https://github.com/Anwar35s/cf_ai_-.git
cd cf_ai_-
npm install
```

Create a `.dev.vars` file for local secrets (never commit this):

```
BRAVE_API_KEY=your_key_here
```

Start the dev server:

```bash
npm run dev
```

Open http://localhost:8787 in your browser.

---

## Deploying to production

```bash
# Deploy the Worker
npm run deploy

# Set your Brave API key as a production secret
npx wrangler secret put BRAVE_API_KEY
```

The frontend (Pages) deploys automatically from GitHub on every push to `main`. Set the **output directory** to `public` in the Pages build settings.

---

## Key technical decisions

**Why Workflows instead of a plain Worker?**  
Workflows are durable — if a step fails, it retries automatically from where it left off. A plain Worker would timeout on slow AI calls and lose all progress. Each `step.do()` call is checkpointed.

**Why Durable Objects instead of KV?**  
Durable Objects give strongly consistent storage and a single-instance guarantee per session ID. KV is eventually consistent, which can cause history to appear out of order. For session memory, consistency matters.

**Why decompose into sub-queries?**  
A single broad search query returns generic results. Breaking it into 3 specific sub-questions and searching each separately produces significantly better source material for the final report.

---

## Built with

- [Cloudflare Workers](https://workers.cloudflare.com)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai) — Llama 3.3 70B
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects)
- [Cloudflare Pages](https://pages.cloudflare.com)
- [Brave Search API](https://api.search.brave.com)
