// memory.ts — Durable Object
//
// A Durable Object is a single-instance stateful class that lives on
// Cloudflare's edge. Unlike KV (eventually consistent), a DO gives you
// strongly consistent storage AND an in-memory object that persists
// between requests to the *same* session.
//
// One DO instance = one user session. The session ID in the URL
// determines which instance handles the request.

export interface ResearchEntry {
  query: string;
  report: string;
  timestamp: number;
}

export class ResearchMemory implements DurableObject {
  private state: DurableObjectState;
  private history: ResearchEntry[] = [];

  constructor(state: DurableObjectState) {
    this.state = state;
    // blockConcurrencyWhile ensures history is loaded before any request
    // is handled — avoids race conditions on startup
    this.state.blockConcurrencyWhile(async () => {
      this.history = (await this.state.storage.get("history")) ?? [];
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/history") {
      return Response.json({ history: this.history });
    }

    if (request.method === "POST" && url.pathname === "/save") {
      const entry: ResearchEntry = await request.json();
      this.history.push(entry);
      // Keep last 20 sessions to avoid unbounded growth
      if (this.history.length > 20) this.history.shift();
      await this.state.storage.put("history", this.history);
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }
}
