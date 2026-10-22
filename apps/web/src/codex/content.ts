import { parse as parseYaml } from "yaml";
import { CodexArticleMetadataSchema, type CodexArticle } from "./types.js";
export { CODEX_CATEGORIES } from "./types.js";

const articleFiles = import.meta.glob("./content/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const wikiLinkPattern = /\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g;

function parseArticle(sourcePath: string, raw: string): CodexArticle {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Codex article ${sourcePath} is missing YAML frontmatter.`);

  let metadata: unknown;
  try {
    metadata = parseYaml(match[1]);
  } catch (error) {
    throw new Error(`Codex article ${sourcePath} has invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  let validatedMetadata;
  try {
    validatedMetadata = CodexArticleMetadataSchema.parse(metadata);
  } catch (error) {
    throw new Error(`Codex article ${sourcePath} has invalid metadata: ${error instanceof Error ? error.message : String(error)}`);
  }

  const body = match[2].trim();
  if (!body) throw new Error(`Codex article ${sourcePath} has no article body.`);
  return { ...validatedMetadata, body, sourcePath };
}

function validateRelationships(articles: readonly CodexArticle[]): void {
  const byId = new Map(articles.map((article) => [article.id, article]));
  const bySlug = new Map(articles.map((article) => [article.slug, article]));
  if (byId.size !== articles.length) throw new Error("The Orraveth Codex contains duplicate article IDs.");
  if (bySlug.size !== articles.length) throw new Error("The Orraveth Codex contains duplicate article slugs.");

  for (const article of articles) {
    for (const targetId of [...article.relatedIds, ...article.relationships.map(({ targetId }) => targetId)]) {
      if (!byId.has(targetId)) {
        throw new Error(`Codex article ${article.id} refers to missing article ID ${targetId}.`);
      }
    }
    if (article.regionId && !byId.has(article.regionId)) {
      throw new Error(`Codex article ${article.id} refers to missing region ${article.regionId}.`);
    }
    for (const [, slug] of article.body.matchAll(wikiLinkPattern)) {
      if (!bySlug.has(slug)) {
        throw new Error(`Codex article ${article.id} links to missing article slug ${slug}.`);
      }
    }
  }
}

const parsedArticles = Object.entries(articleFiles)
  .map(([sourcePath, raw]) => parseArticle(sourcePath, raw))
  .sort((left, right) => left.title.localeCompare(right.title));

validateRelationships(parsedArticles);

export const ORRAVETH_ARTICLES: readonly CodexArticle[] = parsedArticles;
export const ORRAVETH_ARTICLES_BY_ID = new Map(ORRAVETH_ARTICLES.map((article) => [article.id, article]));
export const ORRAVETH_ARTICLES_BY_SLUG = new Map(ORRAVETH_ARTICLES.map((article) => [article.slug, article]));

export function articleHref(slug: string): string {
  return `#/info/codex/article/${encodeURIComponent(slug)}`;
}

export function expandWikiLinks(markdown: string): string {
  return markdown.replace(wikiLinkPattern, (_match, slug: string, label?: string) => {
    const article = ORRAVETH_ARTICLES_BY_SLUG.get(slug);
    return `[${label ?? article?.title ?? slug}](${articleHref(slug)})`;
  });
}

export function searchCodexArticles(query: string): CodexArticle[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return ORRAVETH_ARTICLES.filter((article) => [
    article.title,
    article.summary,
    ...article.tags,
    ...article.aliases,
    article.body,
  ].join("\n").toLocaleLowerCase().includes(normalized));
}
