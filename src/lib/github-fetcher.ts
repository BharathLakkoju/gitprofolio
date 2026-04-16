/**
 * GitHub REST API fetcher module.
 * All calls are server-side only — the GITHUB_TOKEN never reaches the client.
 */

const BASE = "https://api.github.com";

function authHeaders(): HeadersInit {
  const token = import.meta.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function ghFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: authHeaders() });

  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const reset = res.headers.get("X-RateLimit-Reset");
    const resetDate = reset ? new Date(parseInt(reset) * 1000).toISOString() : "unknown";
    throw new RateLimitError(
      `GitHub API rate limit exceeded. Remaining: ${remaining ?? "0"}. Resets at: ${resetDate}. ` +
        "Set the GITHUB_TOKEN environment variable to increase limits.",
    );
  }

  return res;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class UserNotFoundError extends Error {
  constructor(username: string) {
    super(`GitHub user "${username}" not found.`);
    this.name = "UserNotFoundError";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubProfile {
  login: string;
  name: string | null;
  bio: string | null;
  avatar_url: string;
  location: string | null;
  company: string | null;
  blog: string | null;
  twitter_username: string | null;
  followers: number;
  following: number;
  public_repos: number;
  html_url: string;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  created_at: string;
  updated_at: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  language: string | null;
  topics: string[];
  fork: boolean;
  archived: boolean;
  license: { spdx_id: string } | null;
}

export type LanguageMap = Record<string, number>;

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export async function fetchProfile(username: string): Promise<GitHubProfile> {
  const res = await ghFetch(`${BASE}/users/${encodeURIComponent(username)}`);
  if (res.status === 404) throw new UserNotFoundError(username);
  if (!res.ok) throw new Error(`Failed to fetch profile: HTTP ${res.status}`);
  return res.json() as Promise<GitHubProfile>;
}

export async function fetchRepos(username: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await ghFetch(
      `${BASE}/users/${encodeURIComponent(username)}/repos?per_page=${perPage}&page=${page}&sort=pushed`,
    );
    if (!res.ok) throw new Error(`Failed to fetch repos: HTTP ${res.status}`);
    const batch: GitHubRepo[] = await res.json();
    repos.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }

  return repos;
}

export async function fetchLanguages(owner: string, repo: string): Promise<LanguageMap> {
  const res = await ghFetch(
    `${BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`,
  );
  if (!res.ok) return {};
  return res.json() as Promise<LanguageMap>;
}

export async function fetchReadme(owner: string, repo: string): Promise<string | null> {
  const res = await ghFetch(
    `${BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data: { content?: string; encoding?: string } = await res.json();
  if (!data.content || data.encoding !== "base64") return null;
  // Remove newlines inserted by GitHub before decoding
  const clean = data.content.replace(/\n/g, "");
  return Buffer.from(clean, "base64").toString("utf-8");
}
