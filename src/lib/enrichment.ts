/**
 * Enrichment engine — scoring, description cleaning, top project selection.
 */

import type { GitHubRepo } from "./github-fetcher.ts";

// ─── Importance score ─────────────────────────────────────────────────────────

/**
 * Heuristic: score = stars×2 + forks×1.5 + recency(0–3) + descriptionQuality(0–2)
 * Forked repos are penalized (×0.4) to prefer original work.
 * Archived repos are penalized (×0.6).
 */
export function scoreRepo(repo: GitHubRepo, hasDescription: boolean): number {
  const starScore = repo.stargazers_count * 2;
  const forkScore = repo.forks_count * 1.5;
  const recency = recencyScore(repo.updated_at);
  const descScore = hasDescription ? (repo.description ? 2 : 1) : 0;

  let score = starScore + forkScore + recency + descScore;

  if (repo.fork) score *= 0.4;
  if (repo.archived) score *= 0.6;

  return Math.round(score * 10) / 10;
}

function recencyScore(updatedAt: string): number {
  const updatedMs = new Date(updatedAt).getTime();
  const nowMs = Date.now();
  const ageMonths = (nowMs - updatedMs) / (1000 * 60 * 60 * 24 * 30);

  if (ageMonths < 3) return 3;
  if (ageMonths < 6) return 2;
  if (ageMonths < 12) return 1;
  return 0;
}

// ─── Description cleaning ─────────────────────────────────────────────────────

const NOISE_PATTERNS: Array<[RegExp, string]> = [
  [/⭐+/g, ""],
  [/🚀+/g, ""],
  [/!\[.*?\]\(.*?\)/g, ""], // markdown images
  [/\[.*?\]\(.*?\)/g, ""],  // markdown links
  [/<[^>]+>/g, ""],          // HTML tags
  [/`[^`]+`/g, ""],          // inline code
  [/\s+/g, " "],             // normalize whitespace
];

export function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  let text = raw;
  for (const [p, replacement] of NOISE_PATTERNS) {
    text = text.replace(p, replacement);
  }
  text = text.trim();
  if (text.length > 160) {
    // Truncate at last word boundary before 160 chars
    text = text.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  }
  return text.length > 0 ? text : null;
}

// ─── Top projects ─────────────────────────────────────────────────────────────

export function getTopProjects(
  repos: Array<{ name: string; importance_score: number }>,
  n = 5,
): string[] {
  return [...repos]
    .sort((a, b) => b.importance_score - a.importance_score)
    .slice(0, n)
    .map((r) => r.name);
}
