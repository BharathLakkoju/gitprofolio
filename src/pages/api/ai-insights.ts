import type { APIRoute } from "astro";
import {
  analyzeVisibility,
  generateProjectIdeas,
  suggestMissingMetadata,
  findContributionTargets,
  OpenRouterError,
  type RepoSummary,
} from "../../lib/openrouter.ts";
import { isRateLimited, getClientIp } from "../../lib/rate-limiter.ts";
import { logger } from "../../lib/logger.ts";

// ── Constants ──────────────────────────────────────────────────────────────────
/** Max accepted request body size (50 KB). Prevents memory exhaustion via huge repo arrays. */
const MAX_BODY_BYTES = 50 * 1024;
/** Cap the number of repos sent to AI analysis to prevent runaway token/cost usage. */
const MAX_REPOS = 50;
/** Allow 3 AI requests per IP per 10-minute window (LLM calls are expensive). */
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 10 * 60 * 1000;

// ── CORS helpers ───────────────────────────────────────────────────────────────
function getAllowedOrigin(): string {
  return import.meta.env.SITE_ORIGIN ?? "";
}

function buildCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = getAllowedOrigin();
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

function checkOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = getAllowedOrigin();
  if (!allowed) return true;
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
    logger.warn("ai-insights: rejected cross-origin request", {
      origin: request.headers.get("origin"),
    });
    return jsonError("Forbidden", 403, corsHeaders);
  }

  // ── Rate limit ───────────────────────────────────────────────────────────────
  const ip = getClientIp(request);
  if (isRateLimited(ip, RATE_LIMIT, RATE_WINDOW_MS)) {
    logger.warn("ai-insights: rate limit exceeded", { ip });
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

  if (typeof body !== "object" || body === null) {
    return jsonError("Invalid request body.", 400, corsHeaders);
  }

  const { profile, repositories } = body as Record<string, unknown>;

  if (!profile || !Array.isArray(repositories)) {
    return jsonError(
      'Missing required fields: "profile" and "repositories".',
      400,
      corsHeaders,
    );
  }

  // ── Cap array length to prevent token/cost abuse ──────────────────────────
  const cappedRepos = (repositories as Array<Record<string, unknown>>).slice(0, MAX_REPOS);

  try {
    // ── Map & sanitize repo fields to prevent prompt injection ─────────────────
    const repoSummaries: RepoSummary[] = cappedRepos.map((r) => ({
      name: sanitizeText(String(r.name ?? ""), 100),
      description: r.description ? sanitizeText(String(r.description), 300) : null,
      stars: Number(r.stars ?? 0),
      forks: Number(r.forks ?? 0),
      language: r.language ? sanitizeText(String(r.language), 50) : null,
      tech_stack: Array.isArray(r.tech_stack)
        ? (r.tech_stack as string[]).slice(0, 20).map((t) => sanitizeText(String(t), 50))
        : [],
      topics: Array.isArray(r.topics)
        ? (r.topics as string[]).slice(0, 20).map((t) => sanitizeText(String(t), 50))
        : [],
      has_live_link:
        Array.isArray(r.live_links) && (r.live_links as unknown[]).length > 0,
      fork: Boolean(r.fork),
      archived: Boolean(r.archived),
    }));

    const p = profile as Record<string, unknown>;
    const stats = (p.stats ?? {}) as Record<string, unknown>;
    const profileCtx = {
      username: sanitizeText(String(p.username ?? ""), 39),
      name: p.name ? sanitizeText(String(p.name), 100) : null,
      bio: p.bio ? sanitizeText(String(p.bio), 300) : null,
      stats: {
        followers: Number(stats.followers ?? 0),
        public_repos: Number(stats.public_repos ?? 0),
      },
    };

    // Aggregate unique tech and languages across all repos
    const allTech = new Set<string>();
    const allLangs = new Set<string>();
    for (const r of repoSummaries) {
      r.tech_stack.forEach((t) => allTech.add(t));
      if (r.language) allLangs.add(r.language);
    }
    const techStack = Array.from(allTech);
    const languages = Array.from(allLangs);

    // Run all four analyses in parallel
    const [visibilityTips, projectIdeas, metadataSuggestions, contributionTargets] =
      await Promise.all([
        analyzeVisibility(profileCtx, repoSummaries),
        generateProjectIdeas(profileCtx, techStack, repoSummaries),
        suggestMissingMetadata(repoSummaries),
        findContributionTargets(techStack, languages, profileCtx),
      ]);

    return new Response(
      JSON.stringify({
        visibility_tips: visibilityTips,
        project_ideas: projectIdeas,
        metadata_suggestions: metadataSuggestions,
        contribution_targets: contributionTargets,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    if (err instanceof OpenRouterError) {
      // Distinguish config errors (key missing) from upstream failures
      const status = err.status === 0 ? 400 : 502;
      return jsonError("AI service error. Please try again.", status, corsHeaders);
    }
    if (err instanceof SyntaxError) {
      return jsonError("AI returned a malformed response. Please try again.", 502, corsHeaders);
    }
    logger.error("ai-insights: unexpected error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError("An unexpected error occurred.", 500, corsHeaders);
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Strip control characters and truncate to `maxLen` — used to sanitize
 * user-controlled strings before they are embedded in AI prompts, reducing
 * prompt-injection risk.
 */
function sanitizeText(text: string, maxLen: number): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip non-printable control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function jsonError(message: string, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}
