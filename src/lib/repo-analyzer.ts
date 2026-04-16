/**
 * Repo analyzer — extracts meaningful data from raw GitHub repo payloads.
 * Covers: README parsing, tech stack detection, live link extraction.
 */

import type { GitHubRepo, LanguageMap } from "./github-fetcher.ts";

// ─── Tech stack ───────────────────────────────────────────────────────────────

// Well-known technology keywords to scan for in READMEs
const TECH_KEYWORDS: string[] = [
  // JS ecosystem
  "React", "Next.js", "Nuxt", "Vue", "Angular", "Svelte", "Solid",
  "Remix", "Gatsby", "Astro", "Express", "Fastify", "Hono", "Elysia",
  "Node.js", "Deno", "Bun", "TypeScript", "JavaScript",
  "Vite", "Webpack", "Rollup", "Turbopack", "Parcel",
  "Redux", "Zustand", "Jotai", "Recoil", "MobX",
  "GraphQL", "REST", "tRPC", "Socket.io",
  "Prisma", "Drizzle", "Sequelize", "Mongoose", "TypeORM",
  "Tailwind", "shadcn", "Material UI", "Chakra UI", "Ant Design",
  "Jest", "Vitest", "Playwright", "Cypress",
  // Python
  "Python", "FastAPI", "Flask", "Django", "Starlette",
  "NumPy", "Pandas", "Scikit-learn", "TensorFlow", "PyTorch",
  "Keras", "Transformers", "LangChain", "CrewAI",
  // Databases & infra
  "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis",
  "Supabase", "Firebase", "PlanetScale", "Neon", "Turso",
  "Docker", "Kubernetes", "Terraform", "Ansible",
  "AWS", "GCP", "Azure", "Vercel", "Netlify", "Railway", "Fly.io",
  "GitHub Actions", "CI/CD",
  // Langs
  "Rust", "Go", "Java", "Kotlin", "Swift", "C#", "C++", "C",
  "Ruby", "PHP", "Elixir", "Haskell", "Scala",
  // AI/ML
  "OpenAI", "Claude", "Gemini", "LLM", "Ollama", "Hugging Face",
  "Machine Learning", "Deep Learning", "AI", "NLP", "Computer Vision",
  // Other
  "Electron", "React Native", "Flutter", "Expo", "Capacitor",
  "WebAssembly", "WASM", "WebSockets", "WebRTC",
  "Stripe", "Auth0", "Clerk", "NextAuth",
];

// Language name normalizations (GitHub language → friendly name)
const LANG_NORMALIZE: Record<string, string> = {
  JavaScript: "JavaScript",
  TypeScript: "TypeScript",
  Python: "Python",
  Rust: "Rust",
  Go: "Go",
  Java: "Java",
  Kotlin: "Kotlin",
  Swift: "Swift",
  "C#": "C#",
  "C++": "C++",
  C: "C",
  Ruby: "Ruby",
  PHP: "PHP",
  Elixir: "Elixir",
  Haskell: "Haskell",
  Scala: "Scala",
  Dart: "Dart",
  Shell: "Shell",
  HTML: "HTML",
  CSS: "CSS",
  SCSS: "SCSS",
  "Jupyter Notebook": "Jupyter",
  Dockerfile: "Docker",
  HCL: "Terraform",
  Makefile: "Makefile",
};

export function detectTechStack(languages: LanguageMap, readmeText: string | null): string[] {
  const stack = new Set<string>();

  // From languages API
  for (const lang of Object.keys(languages)) {
    const normalized = LANG_NORMALIZE[lang] ?? lang;
    stack.add(normalized);
  }

  // From README keyword scan
  if (readmeText) {
    const text = readmeText;
    for (const kw of TECH_KEYWORDS) {
      // Case-insensitive word boundary match
      const pattern = new RegExp(`(?<![a-zA-Z0-9])${escapeRegex(kw)}(?![a-zA-Z0-9])`, "i");
      if (pattern.test(text)) {
        stack.add(kw);
      }
    }
  }

  return Array.from(stack).slice(0, 15); // cap at 15 to avoid noise
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Live link detection ──────────────────────────────────────────────────────

const LINK_PATTERNS = [
  /https?:\/\/[a-z0-9-]+\.vercel\.app[^\s"')>]*/gi,
  /https?:\/\/[a-z0-9-]+\.netlify\.app[^\s"')>]*/gi,
  /https?:\/\/[a-z0-9-]+\.pages\.dev[^\s"')>]*/gi,
  /https?:\/\/[a-z0-9-]+\.fly\.dev[^\s"')>]*/gi,
  /https?:\/\/[a-z0-9-]+\.railway\.app[^\s"')>]*/gi,
  /https?:\/\/[a-z0-9-]+\.onrender\.com[^\s"')>]*/gi,
  /https?:\/\/[a-z0-9-]+\.up\.railway\.app[^\s"')>]*/gi,
  // Markdown image/link targets that look like live demos
  /\[(?:demo|live|preview|app|website|site)[^\]]*\]\((https?:\/\/[^)]+)\)/gi,
];

export function extractLiveLinks(repo: GitHubRepo, readmeText: string | null): string[] {
  const found = new Set<string>();

  // homepage field (often set to the live site)
  if (repo.homepage) {
    const hp = repo.homepage.trim();
    if (hp.startsWith("http")) found.add(hp);
  }

  if (!readmeText) return Array.from(found);

  for (const pattern of LINK_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = readmeText.matchAll(pattern);
    for (const m of matches) {
      // For the capture-group pattern (markdown links), use group 1
      const url = m[1] ?? m[0];
      // Sanitize trailing punctuation
      found.add(url.replace(/[.,;!]+$/, ""));
    }
  }

  return Array.from(found).slice(0, 5);
}

// ─── README parsing ───────────────────────────────────────────────────────────

export interface ReadmeSummary {
  description: string | null;
  features: string[];
}

export function parseReadme(readmeText: string | null): ReadmeSummary {
  if (!readmeText) return { description: null, features: [] };

  const lines = readmeText.split("\n");
  let description: string | null = null;
  const features: string[] = [];

  let inFeatureSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();

    // Skip main heading (# Title)
    if (/^#\s/.test(line)) { inFeatureSection = false; continue; }

    // Detect feature/highlight section headings
    if (/^#{2,3}\s.*(feature|highlight|what|capabilit|functionalit)/i.test(line)) {
      inFeatureSection = true;
      continue;
    }

    // Leave feature section on next heading
    if (/^#{2,3}\s/.test(line) && inFeatureSection) {
      inFeatureSection = false;
      continue;
    }

    // Capture first non-empty, non-heading, non-badge paragraph as description
    if (!description && line.length > 30 && !line.startsWith("!") && !line.startsWith("[") && !line.startsWith("|") && !line.startsWith("```")) {
      // Strip inline markdown
      description = stripMarkdown(line);
    }

    // Collect feature bullets
    if (inFeatureSection && /^[-*•]\s/.test(line)) {
      const feat = stripMarkdown(line.replace(/^[-*•]\s+/, ""));
      if (feat.length > 5) features.push(feat);
      if (features.length >= 6) break;
    }
  }

  return { description, features };
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // code spans
    .replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, "$1") // bold/italic
    .replace(/<[^>]+>/g, "") // HTML tags
    .replace(/\s+/g, " ")
    .trim();
}
