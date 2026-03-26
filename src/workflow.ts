// workflow.ts — Cloudflare Workflow
//
// A Workflow is a durable multi-step function. Unlike a plain Worker,
// it survives crashes, retries failed steps automatically, and can run
// for minutes. Perfect for a research pipeline that calls multiple APIs.
//
// Each step.do() call is:
//   - Automatically retried on failure
//   - Its result is checkpointed — if the workflow crashes mid-way,
//     completed steps are NOT re-run on resume

import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from "cloudflare:workers";

export interface ResearchParams {
  query: string;
  sessionId: string;
}

interface Env {
  AI: Ai;
  BRAVE_API_KEY: string;
}

export class ResearchWorkflow extends WorkflowEntrypoint<Env, ResearchParams> {
  async run(event: WorkflowEvent<ResearchParams>, step: WorkflowStep) {
    const { query, sessionId } = event.payload;

    // ── Step 1: Decompose ────────────────────────────────────────────────
    // Ask Llama to break the query into 3 focused sub-questions.
    // Smaller, specific searches return better results than one broad search.
    const subQueries: string[] = await step.do("decompose-query", async () => {
      const response = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          {
            role: "system",
            content:
              "You are a research assistant. Break the user's question into 3 focused sub-queries for web search. Respond ONLY with a JSON array of 3 strings, e.g. [\"query1\", \"query2\", \"query3\"]. No other text.",
          },
          { role: "user", content: query },
        ],
      });
      const text = (response as { response: string }).response;
      try {
        return JSON.parse(text);
      } catch {
        // Fallback: use the original query if parsing fails
        return [query];
      }
    });

    // ── Step 2: Search ───────────────────────────────────────────────────
    // Run each sub-query through Brave Search.
    // You'll need a free API key from: https://api.search.brave.com
    const searchResults: string[] = await step.do("web-search", async () => {
      const results: string[] = [];
      for (const q of subQueries) {
        const res = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=3`,
          {
            headers: {
              Accept: "application/json",
              "Accept-Encoding": "gzip",
              "X-Subscription-Token": this.env.BRAVE_API_KEY,
            },
          }
        );
        const data: any = await res.json();
        // Extract snippet text from top results
        const snippets = (data.web?.results ?? [])
          .slice(0, 3)
          .map((r: any) => `${r.title}: ${r.description}`)
          .join("\n");
        results.push(snippets);
      }
      return results;
    });

    // ── Step 3: Summarize ────────────────────────────────────────────────
    // Summarize each sub-query's search results independently.
    // This keeps each LLM call focused and within context limits.
    const summaries: string[] = await step.do("summarize-results", async () => {
      const sums: string[] = [];
      for (let i = 0; i < subQueries.length; i++) {
        const response = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            {
              role: "system",
              content:
                "Summarize the following search results in 2-3 sentences. Be factual and concise.",
            },
            {
              role: "user",
              content: `Question: ${subQueries[i]}\n\nResults:\n${searchResults[i]}`,
            },
          ],
        });
        sums.push((response as { response: string }).response);
      }
      return sums;
    });

    // ── Step 4: Synthesize ───────────────────────────────────────────────
    // Combine all summaries into a final structured research report.
    const report: string = await step.do("synthesize-report", async () => {
      const response = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          {
            role: "system",
            content:
              "You are a research assistant. Write a clear, well-structured research report using the provided summaries. Include a brief intro, key findings, and a conclusion. Use markdown formatting.",
          },
          {
            role: "user",
            content: `Original question: ${query}\n\nResearch summaries:\n${summaries.map((s, i) => `${i + 1}. ${s}`).join("\n\n")}`,
          },
        ],
      });
      return (response as { response: string }).response;
    });

    return { report, subQueries, sessionId };
  }
}
