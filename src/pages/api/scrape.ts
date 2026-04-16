import type { APIRoute } from "astro";
import {
  fetchProfile,
  fetchRepos,
  fetchLanguages,
  fetchReadme,
  RateLimitError,
  UserNotFoundError,
} from "../../lib/github-fetcher.ts";
import { detectTechStack, extractLiveLinks, parseReadme } from "../../lib/repo-analyzer.ts";
import { assembleOutput, type EnrichedRepoInput } from "../../lib/formatter.ts";

export const POST: APIRoute = async ({ request }) => {
  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (typeof body !== "object" || body === null || !("github_username" in body)) {
    return jsonError('Missing required field: "github_username".', 400);
  }

  const username = (body as Record<string, unknown>).github_username;
  if (typeof username !== "string" || username.trim().length === 0) {
    return jsonError('"github_username" must be a non-empty string.', 400);
  }

  const safeUsername = username.trim();

  // Validate: GitHub usernames are alphanumeric + hyphens, 1–39 chars
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(safeUsername)) {
    return jsonError("Invalid GitHub username format.", 400);
  }

  // ── Fetch profile + repos ───────────────────────────────────────────────────
  try {
    const [profile, repos] = await Promise.all([
      fetchProfile(safeUsername),
      fetchRepos(safeUsername),
    ]);

    // ── Per-repo enrichment (parallel, batched to avoid hammering rate limits) ──
    const BATCH_SIZE = 10;
    const enrichedRepos: EnrichedRepoInput[] = [];

    for (let i = 0; i < repos.length; i += BATCH_SIZE) {
      const batch = repos.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (repo) => {
          const [languages, readmeText] = await Promise.all([
            fetchLanguages(safeUsername, repo.name),
            fetchReadme(safeUsername, repo.name),
          ]);
          const techStack = detectTechStack(languages, readmeText);
          const liveLinks = extractLiveLinks(repo, readmeText);
          const readmeParsed = parseReadme(readmeText);
          return { repo, languages, readmeParsed, techStack, liveLinks } satisfies EnrichedRepoInput;
        }),
      );
      enrichedRepos.push(...results);
    }

    // ── Assemble output ─────────────────────────────────────────────────────────
    const output = assembleOutput(profile, enrichedRepos);

    return new Response(JSON.stringify(output), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return jsonError(err.message, 404);
    }
    if (err instanceof RateLimitError) {
      return jsonError(err.message, 429);
    }
    console.error("[scrape] Unexpected error:", err);
    return jsonError("An unexpected error occurred. Please try again later.", 500);
  }
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
