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
import { isRateLimited, getClientIp } from "../../lib/rate-limiter.ts";
import { cacheGet, cacheSet } from "../../lib/cache.ts";
import { logger } from "../../lib/logger.ts";

// ── Constants ──────────────────────────────────────────────────────────────────
/** Max acceptable request body size in bytes (a username is ≤39 chars + JSON overhead). */
const MAX_BODY_BYTES = 512;
/** Cache GitHub scrape results for 5 minutes to reduce API hammering. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Allow 10 scrape requests per IP per 5-minute window. */
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 5 * 60 * 1000;

// ── CORS helpers ───────────────────────────────────────────────────────────────
function getAllowedOrigin(): string {
  return import.meta.env.SITE_ORIGIN ?? "";
}

function buildCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = getAllowedOrigin();
  // Allow same-origin and localhost in development. If SITE_ORIGIN is unset,
  // reflect the request origin (permissive dev mode).
  const isLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(origin);
  const effectiveOrigin =
    !allowed || origin === allowed || isLocalhost ? origin || "*" : allowed;
  return {
    "Access-Control-Allow-Origin": effectiveOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

/** Reject requests from disallowed cross-origins (browser-enforced). */
function checkOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // server-to-server call — no browser CORS
  const allowed = getAllowedOrigin();
  if (!allowed) return true; // SITE_ORIGIN not configured — dev/open mode
  const isLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(origin);
  return origin === allowed || isLocalhost;
}

// ── OPTIONS preflight ──────────────────────────────────────────────────────────
export const OPTIONS: APIRoute = ({ request }) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
};

// ── POST ───────────────────────────────────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
  const corsHeaders = buildCorsHeaders(request);

  // ── CORS origin check ────────────────────────────────────────────────────────
  if (!checkOrigin(request)) {
    logger.warn("scrape: rejected cross-origin request", {
      origin: request.headers.get("origin"),
    });
    return jsonError("Forbidden", 403, corsHeaders);
  }

  // ── Rate limit ───────────────────────────────────────────────────────────────
  const ip = getClientIp(request);
  if (isRateLimited(ip, RATE_LIMIT, RATE_WINDOW_MS)) {
    logger.warn("scrape: rate limit exceeded", { ip });
    return jsonError("Too many requests. Please wait a few minutes.", 429, corsHeaders);
  }

  // ── Payload size guard ───────────────────────────────────────────────────────
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413, corsHeaders);
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413, corsHeaders);
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError("Invalid JSON body.", 400, corsHeaders);
  }

  if (typeof body !== "object" || body === null || !("github_username" in body)) {
    return jsonError('Missing required field: "github_username".', 400, corsHeaders);
  }

  const username = (body as Record<string, unknown>).github_username;
  if (typeof username !== "string" || username.trim().length === 0) {
    return jsonError('"github_username" must be a non-empty string.', 400, corsHeaders);
  }

  const safeUsername = username.trim();

  // Validate: GitHub usernames are alphanumeric + hyphens, 1–39 chars
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(safeUsername)) {
    return jsonError("Invalid GitHub username format.", 400, corsHeaders);
  }

  // ── Cache check ──────────────────────────────────────────────────────────────
  const cacheKey = `scrape:${safeUsername.toLowerCase()}`;
  const cached = cacheGet<unknown>(cacheKey);
  if (cached !== null) {
    logger.info("scrape: cache hit", { username: safeUsername });
    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // ── Fetch profile + repos ─────────────────────────────────────────────────────
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

    // ── Assemble output ───────────────────────────────────────────────────────
    const output = assembleOutput(profile, enrichedRepos);

    // Store in cache
    cacheSet(cacheKey, output, CACHE_TTL_MS);

    return new Response(JSON.stringify(output), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return jsonError("GitHub user not found.", 404, corsHeaders);
    }
    if (err instanceof RateLimitError) {
      return jsonError("GitHub API rate limit reached. Please try again later.", 429, corsHeaders);
    }
    logger.error("scrape: unexpected error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError("An unexpected error occurred. Please try again later.", 500, corsHeaders);
  }
};

function jsonError(message: string, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}
