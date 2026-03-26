// index.ts — API Worker
//
// This is the entry point for all HTTP requests. It does three things:
//   1. Routes POST /research → starts a Workflow instance
//   2. Routes GET  /research/:id → polls the workflow result
//   3. Routes GET/POST /memory → reads/writes the Durable Object
//
// The Worker itself is stateless — state lives in the Workflow (in-flight)
// and the Durable Object (persistent history).

import { ResearchWorkflow } from "./workflow";
import { ResearchMemory } from "./memory";

export { ResearchWorkflow, ResearchMemory };

interface Env {
  AI: Ai;
  RESEARCH_WORKFLOW: Workflow;
  RESEARCH_MEMORY: DurableObjectNamespace;
  BRAVE_API_KEY: string;
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { ...response, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    // POST /research — start a new research workflow
    if (request.method === "POST" && url.pathname === "/research") {
      const { query, sessionId = crypto.randomUUID() } = await request.json() as {
        query: string;
        sessionId?: string;
      };

      if (!query?.trim()) {
        return cors(Response.json({ error: "query is required" }, { status: 400 }));
      }

      // Create a new Workflow instance. Each instance runs independently
      // and can be polled by its ID.
      const instance = await env.RESEARCH_WORKFLOW.create({
        params: { query, sessionId },
      });

      return cors(Response.json({ workflowId: instance.id, sessionId }));
    }

    // GET /research/:workflowId — poll workflow status + result
    const pollMatch = url.pathname.match(/^\/research\/([^/]+)$/);
    if (request.method === "GET" && pollMatch) {
      const instance = await env.RESEARCH_WORKFLOW.get(pollMatch[1]);
      const status = await instance.status();

      if (status.status === "complete") {
        const output = status.output as { report: string; subQueries: string[]; sessionId: string };

        // Save to Durable Object memory when complete
        const doId = env.RESEARCH_MEMORY.idFromName(output.sessionId);
        const stub = env.RESEARCH_MEMORY.get(doId);
        await stub.fetch("https://do/save", {
          method: "POST",
          body: JSON.stringify({
            query: url.searchParams.get("query") ?? "",
            report: output.report,
            timestamp: Date.now(),
          }),
        });

        return cors(Response.json({ status: "complete", ...output }));
      }

      return cors(Response.json({ status: status.status }));
    }

    // GET /memory/:sessionId — fetch research history for a session
    const memMatch = url.pathname.match(/^\/memory\/([^/]+)$/);
    if (request.method === "GET" && memMatch) {
      const doId = env.RESEARCH_MEMORY.idFromName(memMatch[1]);
      const stub = env.RESEARCH_MEMORY.get(doId);
      const res = await stub.fetch("https://do/history");
      return cors(res);
    }

    return cors(new Response("Not found", { status: 404 }));
  },
};
