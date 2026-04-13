import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "github-search",
  version: "1.0.0",
});

// --- GitHub data fetching ---

type Comment = { author: string; body: string };
type PullRequest = {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  labels: string[];
  merged_at: string | null;
  closed_at: string | null;
  comments: Comment[];
};
type Issue = {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  labels: string[];
  closed_at: string | null;
  comments: Comment[];
};

async function hasGhCli(): Promise<boolean> {
  try {
    // Check both presence and auth status
    const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function runGh(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`gh ${args[0]} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
}

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API ${resp.status}: ${text}`);
  }
  return resp.json();
}

// --- gh CLI fetchers ---

async function fetchPullsGh(repo: string, count: number, state: string): Promise<PullRequest[]> {
  const ghState = state === "merged" ? "merged" : "closed";
  const json = await runGh(
    "pr", "list", "--repo", repo, "--state", ghState, "--limit", String(count),
    "--json", "number,title,body,url,author,labels,mergedAt,closedAt",
  );
  const items = JSON.parse(json) as Array<{
    number: number; title: string; body: string; url: string;
    author: { login: string }; labels: Array<{ name: string }>;
    mergedAt: string | null; closedAt: string | null;
  }>;

  const results: PullRequest[] = [];
  for (const item of items) {
    const comments = await fetchCommentsGh(repo, item.number);
    results.push({
      number: item.number,
      title: item.title,
      body: (item.body || "").slice(0, 2000),
      url: item.url,
      author: item.author.login,
      labels: item.labels.map((l) => l.name),
      merged_at: item.mergedAt,
      closed_at: item.closedAt,
      comments,
    });
  }
  return results;
}

async function fetchIssuesGh(repo: string, count: number): Promise<Issue[]> {
  const json = await runGh(
    "issue", "list", "--repo", repo, "--state", "closed", "--limit", String(count),
    "--json", "number,title,body,url,author,labels,closedAt",
  );
  const items = JSON.parse(json) as Array<{
    number: number; title: string; body: string; url: string;
    author: { login: string }; labels: Array<{ name: string }>;
    closedAt: string | null;
  }>;

  const results: Issue[] = [];
  for (const item of items) {
    const comments = await fetchCommentsGh(repo, item.number);
    results.push({
      number: item.number,
      title: item.title,
      body: (item.body || "").slice(0, 2000),
      url: item.url,
      author: item.author.login,
      labels: item.labels.map((l) => l.name),
      closed_at: item.closedAt,
      comments,
    });
  }
  return results;
}

async function fetchCommentsGh(repo: string, issueNumber: number): Promise<Comment[]> {
  try {
    const json = await runGh("api", `repos/${repo}/issues/${issueNumber}/comments`, "--jq", ".[0:3] | .[] | {author: .user.login, body: .body}");
    if (!json) return [];
    const lines = json.split("\n").filter(Boolean);
    return lines.map((line) => {
      const parsed = JSON.parse(line) as { author: string; body: string };
      return { author: parsed.author, body: (parsed.body || "").slice(0, 1000) };
    });
  } catch {
    return [];
  }
}

// --- REST API fetchers ---

async function fetchPullsRest(repo: string, count: number, state: string): Promise<PullRequest[]> {
  // Request more items when filtering for merged, since REST API returns all closed
  const fetchCount = state === "merged" ? count * 5 : count;
  const data = (await fetchJson(
    `https://api.github.com/repos/${repo}/pulls?state=closed&per_page=${fetchCount}&sort=updated&direction=desc`,
  )) as Array<{
    number: number; title: string; body: string; html_url: string;
    user: { login: string }; labels: Array<{ name: string }>;
    merged_at: string | null; closed_at: string | null;
  }>;

  let items = data;
  if (state === "merged") {
    items = items.filter((p) => p.merged_at !== null);
  }

  const results: PullRequest[] = [];
  for (const item of items.slice(0, count)) {
    const comments = await fetchCommentsRest(repo, item.number);
    results.push({
      number: item.number,
      title: item.title,
      body: (item.body || "").slice(0, 2000),
      url: item.html_url,
      author: item.user.login,
      labels: item.labels.map((l) => l.name),
      merged_at: item.merged_at,
      closed_at: item.closed_at,
      comments,
    });
  }
  return results;
}

async function fetchIssuesRest(repo: string, count: number): Promise<Issue[]> {
  const data = (await fetchJson(
    `https://api.github.com/repos/${repo}/issues?state=closed&per_page=${count}&sort=updated&direction=desc`,
  )) as Array<{
    number: number; title: string; body: string; html_url: string;
    user: { login: string }; labels: Array<{ name: string }>;
    closed_at: string | null; pull_request?: unknown;
  }>;

  // GitHub issues API returns PRs too — filter them out
  const issues = data.filter((item) => !item.pull_request);

  const results: Issue[] = [];
  for (const item of issues.slice(0, count)) {
    const comments = await fetchCommentsRest(repo, item.number);
    results.push({
      number: item.number,
      title: item.title,
      body: (item.body || "").slice(0, 2000),
      url: item.html_url,
      author: item.user.login,
      labels: item.labels.map((l) => l.name),
      closed_at: item.closed_at,
      comments,
    });
  }
  return results;
}

async function fetchCommentsRest(repo: string, issueNumber: number): Promise<Comment[]> {
  try {
    const data = (await fetchJson(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments?per_page=3`,
    )) as Array<{ user: { login: string }; body: string }>;
    return data.map((c) => ({
      author: c.user.login,
      body: (c.body || "").slice(0, 1000),
    }));
  } catch {
    return [];
  }
}

// --- Exported for testing ---

export { hasGhCli, fetchPullsGh, fetchPullsRest, fetchIssuesGh, fetchIssuesRest };

// --- MCP tools ---

const useGh = await hasGhCli();

server.tool(
  "search_pulls",
  "Ищет закрытые или вмердженные Pull Requests в GitHub-репозитории. Возвращает JSON с данными PR включая top-3 комментариев.",
  {
    repo: z.string().describe("Репозиторий в формате owner/repo, например spring-projects/spring-boot"),
    count: z.number().default(5).describe("Количество PR для получения"),
    state: z.enum(["closed", "merged"]).default("closed").describe("Статус PR: closed или merged"),
  },
  async ({ repo, count, state }) => {
    try {
      const pulls = useGh
        ? await fetchPullsGh(repo, count, state)
        : await fetchPullsRest(repo, count, state);
      return { content: [{ type: "text", text: JSON.stringify(pulls, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Ошибка при поиске PR: ${(error as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "search_issues",
  "Ищет закрытые Issues в GitHub-репозитории. Возвращает JSON с данными issues включая top-3 комментариев.",
  {
    repo: z.string().describe("Репозиторий в формате owner/repo, например spring-projects/spring-boot"),
    count: z.number().default(5).describe("Количество issues для получения"),
  },
  async ({ repo, count }) => {
    try {
      const issues = useGh
        ? await fetchIssuesGh(repo, count)
        : await fetchIssuesRest(repo, count);
      return { content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Ошибка при поиске issues: ${(error as Error).message}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
