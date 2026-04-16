import type { APIRoute } from "astro";
import {
  analyzeVisibility,
  generateProjectIdeas,
  suggestMissingMetadata,
  findContributionTargets,
  OpenRouterError,
  type RepoSummary,
} from "../../lib/openrouter.ts";

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError("Invalid request body.", 400);
  }

  const { profile, repositories } = body as Record<string, unknown>;

  if (!profile || !Array.isArray(repositories)) {
    return jsonError(
      'Missing required fields: "profile" and "repositories".',
      400,
    );
  }

  try {
    const repoSummaries: RepoSummary[] = (repositories as Array<Record<string, unknown>>).map(
      (r) => ({
        name: String(r.name ?? ""),
        description: r.description ? String(r.description) : null,
        stars: Number(r.stars ?? 0),
        forks: Number(r.forks ?? 0),
        language: r.language ? String(r.language) : null,
        tech_stack: Array.isArray(r.tech_stack)
          ? (r.tech_stack as string[])
          : [],
        topics: Array.isArray(r.topics) ? (r.topics as string[]) : [],
        has_live_link:
          Array.isArray(r.live_links) && (r.live_links as unknown[]).length > 0,
        fork: Boolean(r.fork),
        archived: Boolean(r.archived),
      }),
    );

    const p = profile as Record<string, unknown>;
    const stats = (p.stats ?? {}) as Record<string, unknown>;
    const profileCtx = {
      username: String(p.username ?? ""),
      name: p.name ? String(p.name) : null,
      bio: p.bio ? String(p.bio) : null,
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
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof OpenRouterError) {
      const status = err.status === 0 ? 400 : 502;
      return jsonError(err.message, status);
    }
    if (err instanceof SyntaxError) {
      return jsonError(
        "AI returned a malformed response. Please try again.",
        502,
      );
    }
    console.error("[ai-insights]", err);
    return jsonError("An unexpected error occurred.", 500);
  }
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
