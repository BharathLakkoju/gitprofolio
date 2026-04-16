# 📄 Product Requirements Document (PRD)

## Product Name: **Gitfolio Extractor**

---

## 1. 🎯 Overview

**Problem**
Developers struggle to manually curate GitHub data into a polished portfolio. Key information like:

* meaningful project descriptions
* tech stacks
* live/demo links
* highlights

…are scattered, inconsistent, or missing.

**Solution**
A tool that:

* takes a **GitHub username**
* **scrapes + enriches profile + repo data**
* returns a **structured JSON output**
* optimized for **portfolio generation, resumes, and personal branding**

---

## 2. 🧠 Goals & Non-Goals

### Goals

* Extract **complete GitHub profile + repo data**
* Normalize into **clean, structured JSON**
* Identify:

  * Tech stack per repo
  * Live/demo links
  * Project importance
* Provide **high signal → low noise output**

### Non-Goals (V1)

* Private repo access
* Deep code analysis (AST-level parsing)
* Real-time sync (batch processing only)

---

## 3. 👤 Target Users

* Developers building portfolios
* Students applying for internships/jobs
* Indie hackers / builders
* Tools like your **ATS/portfolio generator**

---

## 4. ⚙️ Functional Requirements

### 4.1 Input

```json
{
  "github_username": "string"
}
```

---

### 4.2 Data Extraction

#### A. Profile Data

* Name
* Bio
* Avatar URL
* Location
* Company
* Blog/website
* Twitter/social links
* Followers / following
* Public repo count

---

#### B. Repository Data (for each public repo)

**Basic Info**

* Name
* Description
* Repo URL
* Created at / updated at
* Stars, forks, watchers
* Primary language

**Advanced Extraction**

* Tech stack (multi-language detection)
* Topics/tags
* README parsing:

  * Extract:

    * project description
    * features
    * usage
    * screenshots (optional)
* Deployment links:

  * Vercel / Netlify / custom domains
* License
* Contribution stats (optional V2)

---

### 4.3 Enrichment Layer (IMPORTANT)

Raw GitHub data is weak → you must **enhance it**

#### A. Tech Stack Detection

* From:

  * languages API
  * package.json
  * requirements.txt
  * README keywords

#### B. Live Link Detection

* Regex + known domains:

  * `vercel.app`
  * `netlify.app`
  * custom domains

#### C. Project Importance Score

Heuristic:

```
score = stars * 2 + forks * 1.5 + recency + description_quality
```

#### D. Description Cleaning

* Remove noise
* Convert to 1–2 line portfolio-ready summary

---

## 5. 📦 Output JSON Schema

```json
{
  "profile": {
    "username": "string",
    "name": "string",
    "bio": "string",
    "avatar_url": "string",
    "location": "string",
    "company": "string",
    "website": "string",
    "socials": {
      "twitter": "string",
      "linkedin": "string"
    },
    "stats": {
      "followers": 0,
      "following": 0,
      "public_repos": 0
    }
  },
  "repositories": [
    {
      "name": "string",
      "description": "string",
      "clean_description": "string",
      "url": "string",
      "created_at": "ISO date",
      "updated_at": "ISO date",
      "stars": 0,
      "forks": 0,
      "language": "string",
      "tech_stack": ["React", "Node.js"],
      "topics": ["ai", "portfolio"],
      "live_links": ["https://..."],
      "readme_summary": "string",
      "importance_score": 0
    }
  ],
  "top_projects": ["repo_name_1", "repo_name_2"]
}
```

---

## 6. 🧩 System Architecture

### Frontend

* Input field (GitHub username)
* JSON preview
* Download JSON
* Future: portfolio preview

**Stack**

* Next.js + Tailwind + shadcn

---

### Backend

#### Core Modules

1. **GitHub Fetcher**

   * GitHub REST API / GraphQL API
   * Rate-limit handling
   * Pagination

2. **Repo Analyzer**

   * Fetch README
   * Parse languages
   * Extract metadata

3. **Enrichment Engine**

   * Tech stack inference
   * Link detection
   * Scoring system

4. **Formatter**

   * Convert → final JSON schema

---

### Optional AI Layer (V2)

* Clean descriptions
* Generate summaries
* Tag projects intelligently

---

## 7. 🔌 APIs Used

* GitHub REST API
  `https://api.github.com/users/{username}`
* GitHub Repos API
  `https://api.github.com/users/{username}/repos`
* GitHub Languages API
  `/repos/{owner}/{repo}/languages`
* README API
  `/repos/{owner}/{repo}/readme`

---

## 8. 🚧 Edge Cases

* Empty README
* No description
* Forked repos (filter or deprioritize)
* Archived repos
* Huge repo lists (pagination)
* API rate limits

---

## 9. 📊 Success Metrics

* % of repos with detected tech stack
* % of repos with valid live links
* Accuracy of top project ranking
* JSON completeness score

---

## 10. 🛣️ Roadmap

### V1 (Core)

* Fetch profile + repos
* Basic JSON output
* Simple tech stack detection

### V2 (Smart Layer)

* README parsing
* Project ranking
* Live link detection

### V3 (AI Layer)

* Auto portfolio generation
* Resume bullets
* Project storytelling

---

## 11. 💡 Future Extensions (This is where it gets powerful)

* Turn JSON → **portfolio website auto-generator**
* Export → **resume-ready bullets**
* Compare GitHub profiles
* ATS scoring (ties perfectly to your **atsprecise** idea)

---

## 12. ⚠️ Technical Risks

* GitHub API rate limits → use token auth
* Inconsistent READMEs → noisy parsing
* Tech stack inference ambiguity
* Fake/invalid deployment links

---

## 13. 🧪 Example Flow

1. User enters: `bharath-dev`
2. Backend fetches:

   * profile
   * repos
3. For each repo:

   * fetch languages
   * parse README
   * detect links
4. Enrich + score
5. Return JSON