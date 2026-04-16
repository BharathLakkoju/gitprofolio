/**
 * Formatter — assembles the final PRD-compliant JSON output.
 */

import type { GitHubProfile, GitHubRepo, LanguageMap } from "./github-fetcher.ts";
import type { ReadmeSummary } from "./repo-analyzer.ts";
import { cleanDescription, getTopProjects, scoreRepo } from "./enrichment.ts";

// ─── Output types (matches PRD JSON schema) ───────────────────────────────────

export interface OutputProfile {
  username: string;
  name: string | null;
  bio: string | null;
  avatar_url: string;
  location: string | null;
  company: string | null;
  website: string | null;
  socials: {
    twitter: string | null;
    linkedin: string | null;
  };
  stats: {
    followers: number;
    following: number;
    public_repos: number;
  };
}

export interface OutputRepo {
  name: string;
  description: string | null;
  clean_description: string | null;
  url: string;
  created_at: string;
  updated_at: string;
  stars: number;
  forks: number;
  watchers: number;
  language: string | null;
  tech_stack: string[];
  topics: string[];
  live_links: string[];
  readme_summary: string | null;
  readme_features: string[];
  importance_score: number;
  fork: boolean;
  archived: boolean;
  license: string | null;
}

export interface ExtractorOutput {
  profile: OutputProfile;
  repositories: OutputRepo[];
  top_projects: string[];
}

// ─── Per-repo enriched input ──────────────────────────────────────────────────

export interface EnrichedRepoInput {
  repo: GitHubRepo;
  languages: LanguageMap;
  readmeParsed: ReadmeSummary;
  techStack: string[];
  liveLinks: string[];
}

// ─── Assembler ────────────────────────────────────────────────────────────────

export function assembleOutput(
  profile: GitHubProfile,
  enrichedRepos: EnrichedRepoInput[],
): ExtractorOutput {
  // Extract possible LinkedIn URL from bio
  const linkedin = extractLinkedin(profile.bio);

  const outputProfile: OutputProfile = {
    username: profile.login,
    name: profile.name,
    bio: profile.bio,
    avatar_url: profile.avatar_url,
    location: profile.location,
    company: profile.company,
    website: profile.blog || null,
    socials: {
      twitter: profile.twitter_username
        ? `https://twitter.com/${profile.twitter_username}`
        : null,
      linkedin,
    },
    stats: {
      followers: profile.followers,
      following: profile.following,
      public_repos: profile.public_repos,
    },
  };

  const outputRepos: OutputRepo[] = enrichedRepos.map(({ repo, readmeParsed, techStack, liveLinks }) => {
    const hasDesc = !!(repo.description || readmeParsed.description);
    const score = scoreRepo(repo, hasDesc);
    const rawDesc = repo.description || readmeParsed.description;
    return {
      name: repo.name,
      description: repo.description,
      clean_description: cleanDescription(rawDesc ?? null),
      url: repo.html_url,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      watchers: repo.watchers_count,
      language: repo.language,
      tech_stack: techStack,
      topics: repo.topics ?? [],
      live_links: liveLinks,
      readme_summary: readmeParsed.description,
      readme_features: readmeParsed.features,
      importance_score: score,
      fork: repo.fork,
      archived: repo.archived,
      license: repo.license?.spdx_id ?? null,
    };
  });

  // Sort by importance descending
  outputRepos.sort((a, b) => b.importance_score - a.importance_score);

  const top_projects = getTopProjects(outputRepos);

  return {
    profile: outputProfile,
    repositories: outputRepos,
    top_projects,
  };
}

function extractLinkedin(bio: string | null): string | null {
  if (!bio) return null;
  const match = bio.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/);
  return match ? match[0] : null;
}
