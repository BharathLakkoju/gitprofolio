/**
 * OpenRouter AI client and analysis functions.
 */

const BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openrouter/elephant-alpha";

// ─── Error ────────────────────────────────────────────────────────────────────

export class OpenRouterError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface VisibilityTip {
  repo: string;
  category: string;
  tip: string;
  priority: "high" | "medium" | "low";
}

export interface ProjectIdea {
  title: string;
  description: string;
  tech_stack: string[];
  why_stars: string;
  difficulty: "beginner" | "intermediate" | "advanced";
}

export interface MetadataSuggestion {
  repo: string;
  suggested_description?: string;
  suggested_topics?: string[];
}

export interface ContributionTarget {
  name: string;
  url: string;
  description: string;
  why: string;
  tech: string[];
  good_first_issues: boolean;
}

export interface AIInsights {
  visibility_tips: VisibilityTip[];
  project_ideas: ProjectIdea[];
  metadata_suggestions: MetadataSuggestion[];
  contribution_targets: ContributionTarget[];
}

// ─── Shared input types ───────────────────────────────────────────────────────

export interface ProfileCtx {
  username: string;
  name: string | null;
  bio: string | null;
  stats: { followers: number; public_repos: number };
}

export interface RepoSummary {
  name: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  tech_stack: string[];
  topics: string[];
  has_live_link: boolean;
  fork: boolean;
  archived: boolean;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function complete(prompt: string): Promise<string> {
  const apiKey = import.meta.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError(
      0,
      "OPENROUTER_API_KEY is not set. Add it to your .env file.",
    );
  }

  const model = import.meta.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://gitprofolio.vercel.app",
      "X-Title": "Gitprofolio",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. Always respond with valid JSON only. Do not wrap in markdown code fences.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new OpenRouterError(
      res.status,
      `OpenRouter error ${res.status}: ${text.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  // Strip any accidental markdown fences
  return content
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

// ─── Analysis functions ───────────────────────────────────────────────────────

export async function analyzeVisibility(
  profile: ProfileCtx,
  repos: RepoSummary[],
): Promise<VisibilityTip[]> {
  const original = repos
    .filter((r) => !r.fork && !r.archived)
    .slice(0, 15)
    .map((r) => ({
      name: r.name,
      description: r.description,
      stars: r.stars,
      forks: r.forks,
      language: r.language,
      topics: r.topics,
      has_live_link: r.has_live_link,
    }));

  const prompt = `Analyze this GitHub developer's profile and repositories. Provide actionable, specific tips to improve their visibility and earn more stars.

Profile:
${JSON.stringify({ username: profile.username, bio: profile.bio, followers: profile.stats.followers, public_repos: profile.stats.public_repos })}

Original repositories:
${JSON.stringify(original)}

Return JSON with this exact structure:
{
  "tips": [
    {
      "repo": "repository-name or 'profile' for profile-level tips",
      "category": "one of: readme, description, topics, activity, community, seo, general",
      "tip": "specific and actionable tip",
      "priority": "high or medium or low"
    }
  ]
}

Return 10-14 tips covering diverse categories. Lead with high-priority items.`;

  const raw = await complete(prompt);
  const parsed = JSON.parse(raw) as { tips?: VisibilityTip[] };
  return parsed.tips ?? [];
}

export async function generateProjectIdeas(
  profile: ProfileCtx,
  techStack: string[],
  repos: RepoSummary[],
): Promise<ProjectIdea[]> {
  const prompt = `Suggest new open source project ideas for a GitHub developer that would attract stars and grow their following.

Developer:
- Username: ${profile.username}
- Followers: ${profile.stats.followers}
- Tech stack: ${techStack.slice(0, 20).join(", ")}
- Existing projects: ${repos
    .filter((r) => !r.fork)
    .slice(0, 10)
    .map((r) => r.name)
    .join(", ")}

Return JSON with this exact structure:
{
  "ideas": [
    {
      "title": "Project Name",
      "description": "what it does and the problem it solves",
      "tech_stack": ["tech1", "tech2"],
      "why_stars": "why this project would attract stars and engagement",
      "difficulty": "beginner or intermediate or advanced"
    }
  ]
}

Return 6 ideas across different difficulty levels. Focus on tools, libraries, and projects that solve real developer pain points.`;

  const raw = await complete(prompt);
  const parsed = JSON.parse(raw) as { ideas?: ProjectIdea[] };
  return parsed.ideas ?? [];
}

export async function suggestMissingMetadata(
  repos: RepoSummary[],
): Promise<MetadataSuggestion[]> {
  const original = repos.filter((r) => !r.fork && !r.archived);

  const noDesc = original.filter((r) => !r.description).slice(0, 12);
  const noTopics = original.filter((r) => r.topics.length === 0).slice(0, 12);

  if (noDesc.length === 0 && noTopics.length === 0) return [];

  // Collect results into separate maps, then merge — avoids async shared-state bugs
  const descResults = new Map<string, string>();
  const topicsResults = new Map<string, string[]>();

  // ── Step 1: descriptions ────────────────────────────────────────────────────
  if (noDesc.length > 0) {
    const list = noDesc.map((r) => ({
      name: r.name,
      language: r.language,
      tech_stack: r.tech_stack.slice(0, 8),
    }));

    const prompt = `Write a concise, portfolio-ready GitHub repository description for each repository below. Return ONLY descriptions — no topics.

Repositories:
${JSON.stringify(list)}

Return JSON — nothing else:
{
  "descriptions": [
    { "repo": "repository-name", "description": "1-2 sentence description, under 160 characters" }
  ]
}`;

    const raw = await complete(prompt);
    const parsed = JSON.parse(raw) as {
      descriptions?: Array<{ repo: string; description: string }>;
    };
    for (const item of parsed.descriptions ?? []) {
      if (item.repo && item.description) descResults.set(item.repo, item.description);
    }
  }

  // ── Step 2: topics ──────────────────────────────────────────────────────────
  if (noTopics.length > 0) {
    const list = noTopics.map((r) => ({
      name: r.name,
      language: r.language,
      tech_stack: r.tech_stack.slice(0, 8),
      description: r.description ?? null,
    }));

    const prompt = `Suggest GitHub topic tags for each repository below. Return ONLY topics — no descriptions.

Rules: lowercase, hyphen-separated, 3-6 tags per repo, mix language/framework/use-case tags.

Repositories:
${JSON.stringify(list)}

Return JSON — nothing else:
{
  "topics": [
    { "repo": "repository-name", "topics": ["tag1", "tag2", "tag3"] }
  ]
}`;

    const raw = await complete(prompt);
    const parsed = JSON.parse(raw) as {
      topics?: Array<{ repo: string; topics: string[] }>;
    };
    for (const item of parsed.topics ?? []) {
      if (item.repo && Array.isArray(item.topics) && item.topics.length)
        topicsResults.set(item.repo, item.topics);
    }
  }

  // ── Merge: a repo may appear in one or both maps ────────────────────────────
  const allNames = new Set([...descResults.keys(), ...topicsResults.keys()]);
  return Array.from(allNames).map((name): MetadataSuggestion => {
    const suggestion: MetadataSuggestion = { repo: name };
    const desc = descResults.get(name);
    const topics = topicsResults.get(name);
    if (desc) suggestion.suggested_description = desc;
    if (topics) suggestion.suggested_topics = topics;
    return suggestion;
  });
}

export async function findContributionTargets(
  techStack: string[],
  languages: string[],
  profile: ProfileCtx,
): Promise<ContributionTarget[]> {
  const prompt = `Suggest well-known open source GitHub repositories this developer should contribute to for visibility and networking.

Developer profile:
- Languages: ${languages.slice(0, 8).join(", ")}
- Tech stack: ${techStack.slice(0, 15).join(", ")}
- Followers: ${profile.stats.followers}
- Public repos: ${profile.stats.public_repos}

Return JSON with this exact structure:
{
  "targets": [
    {
      "name": "owner/repository-name",
      "url": "https://github.com/owner/repository-name",
      "description": "what the project does",
      "why": "specific reason contributing here would boost this developer's visibility",
      "tech": ["tech1", "tech2"],
      "good_first_issues": true
    }
  ]
}

Return 6-8 real, active repositories. Mix large well-known projects with growing ones where contributions get noticed. Use real GitHub repository URLs.`;

  const raw = await complete(prompt);
  const parsed = JSON.parse(raw) as { targets?: ContributionTarget[] };
  return parsed.targets ?? [];
}
