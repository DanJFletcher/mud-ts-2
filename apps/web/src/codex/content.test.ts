import { describe, expect, it } from "vitest";
import {
  articleHref,
  expandWikiLinks,
  ORRAVETH_ARTICLES,
  ORRAVETH_ARTICLES_BY_ID,
  ORRAVETH_ARTICLES_BY_SLUG,
  searchCodexArticles,
} from "./content.js";
import { CODEX_CATEGORIES, CodexArticleMetadataSchema } from "./types.js";

describe("Orraveth Codex content", () => {
  it("loads a structured catalog that belongs only to Orraveth", () => {
    expect(ORRAVETH_ARTICLES.length).toBeGreaterThanOrEqual(70);
    expect(new Set(ORRAVETH_ARTICLES.map((article) => article.id)).size).toBe(ORRAVETH_ARTICLES.length);
    expect(new Set(ORRAVETH_ARTICLES.map((article) => article.slug)).size).toBe(ORRAVETH_ARTICLES.length);
    expect(ORRAVETH_ARTICLES.every((article) => article.worldId === "orraveth")).toBe(true);
    expect(new Set(ORRAVETH_ARTICLES.map((article) => article.category))).toEqual(
      new Set(CODEX_CATEGORIES.map((category) => category.id)),
    );
    expect(ORRAVETH_ARTICLES_BY_ID.size).toBe(ORRAVETH_ARTICLES.length);
    expect(ORRAVETH_ARTICLES_BY_SLUG.size).toBe(ORRAVETH_ARTICLES.length);
  });

  it("keeps required people, places, traditions, and mysteries independently addressable", () => {
    const requiredSlugs = [
      "orraveth",
      "lantern-covenant",
      "sevenfold-workshop",
      "returning-tide",
      "rootless-way",
      "resonance",
      "kindling",
      "shaping",
      "veiling",
      "binding",
      "listening",
      "sword-called-mercy",
      "house-that-waits",
      "widow-of-river",
      "kindly-roof-hearth",
      "severin-vale",
      "mara-vale",
      "elira-venn",
      "bellwold",
      "bellwold-south-common",
      "well-court",
      "wattle-row",
      "bellwold-common-house",
      "sovens-wheelwright-yard",
      "tallow-end-cottage",
      "old-grain-house",
      "rell-soven",
      "enna-pell",
      "seli-tor",
      "aven-rusk",
      "silent-bell",
      "forgotten-journal",
      "mill-that-never-sleeps",
      "anwens-balance-scale",
    ];
    for (const slug of requiredSlugs) expect(ORRAVETH_ARTICLES_BY_SLUG.has(slug), slug).toBe(true);
  });

  it("preserves unresolved and disputed accounts as such", () => {
    expect(ORRAVETH_ARTICLES_BY_SLUG.get("cosmology-and-creation")?.canonStatus).toBe("Disputed");
    expect(ORRAVETH_ARTICLES_BY_SLUG.get("silent-bell")?.canonStatus).toBe("Unresolved");
    expect(ORRAVETH_ARTICLES_BY_SLUG.get("hollowing")?.canonStatus).toBe("Disputed");
    expect(ORRAVETH_ARTICLES_BY_SLUG.get("mill-that-never-sleeps")?.claims).toContainEqual(
      expect.objectContaining({ epistemicStatus: "objective fact" }),
    );
    expect(ORRAVETH_ARTICLES_BY_SLUG.get("everyday-life")?.canonStatus).toBe("Provisional Canon");
  });

  it("records gold as Orraveth's provisional currency without inventing regional exchange rules", () => {
    const currency = ORRAVETH_ARTICLES_BY_SLUG.get("currency-and-commerce");
    expect(currency?.canonStatus).toBe("Provisional Canon");
    expect(currency?.body).toContain("Gold is the current provisional currency name used in Orraveth.");
    expect(ORRAVETH_ARTICLES_BY_SLUG.get("bellwold")?.relatedIds).toContain("orraveth-currency-and-commerce");
    expect(ORRAVETH_ARTICLES_BY_SLUG.get("orraveth")?.relatedIds).toContain("orraveth-currency-and-commerce");
  });

  it("supports full-text search, aliases, and safe internal article links", () => {
    expect(searchCodexArticles("Professor Elira Venn").some((article) => article.slug === "elira-venn")).toBe(true);
    expect(searchCodexArticles("Open Lanterns").some((article) => article.slug === "lantern-covenant")).toBe(true);
    expect(expandWikiLinks("Read [[silent-bell|the bell record]].")).toBe(
      `Read [the bell record](${articleHref("silent-bell")}).`,
    );
  });

  it("rejects metadata that attempts to attach Orraveth content to another world", () => {
    const existing = ORRAVETH_ARTICLES[0];
    const { body: _body, sourcePath: _sourcePath, ...metadata } = existing;
    expect(CodexArticleMetadataSchema.safeParse({ ...metadata, worldId: "mudd-demo-instance" }).success).toBe(false);
  });
});
