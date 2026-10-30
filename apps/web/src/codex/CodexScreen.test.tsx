import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import CodexScreen from "./CodexScreen.js";
import { ORRAVETH_ARTICLES_BY_SLUG } from "./content.js";

describe("CodexScreen", () => {
  beforeEach(() => {
    window.location.hash = "#/info/codex";
  });

  it("opens on the Orraveth index with the archive sections", () => {
    render(<CodexScreen />);
    expect(screen.getByRole("heading", { name: /A world, carefully remembered/ })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Codex sections" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Explore/ })).toHaveAttribute("href", "#/info/codex/explore");
    expect(screen.getByText("Orraveth is separate from the active MUDD world.")).toBeVisible();
  });

  it("searches article text and opens the selected result with the keyboard", async () => {
    render(<CodexScreen />);
    const search = screen.getByRole("textbox", { name: "Search articles" });
    fireEvent.change(search, { target: { value: "Elira Venn" } });
    fireEvent.keyDown(search, { key: "Enter" });

    await screen.findByRole("heading", { name: "“Elira Venn”" });
    expect(screen.getByRole("link", { name: /Professor Elira Venn/ })).toBeVisible();
    const firstResult = screen.getAllByRole("option")[0];
    const firstResultTitle = within(firstResult).getByRole("link").textContent?.trim() ?? "";
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(search, { key: "Enter" });
    await screen.findByRole("heading", { level: 1, name: firstResultTitle });
    expect(screen.getByText(/Canon$/, { selector: ".codex-article-meta .codex-canon" })).toBeVisible();
  });

  it("renders a mystery article and turns internal links into Codex navigation", async () => {
    window.location.hash = "#/info/codex/article/silent-bell";
    render(<CodexScreen />);
    expect(await screen.findByRole("heading", { name: "The Silent Bell" })).toBeVisible();
    const towerLink = screen.getByRole("link", { name: /Bellwold's old bell tower/ });
    expect(towerLink).toHaveAttribute("href", "#/info/codex/article/old-bell-tower");
    fireEvent.click(towerLink);
    await screen.findByRole("heading", { name: "Bellwold's old bell tower" });
  });

  it("shows the region directory without requiring map coordinates", async () => {
    window.location.hash = "#/info/codex/atlas";
    render(<CodexScreen />);
    expect(await screen.findByRole("heading", { name: "Regions & places" })).toBeVisible();
    expect(screen.getByRole("link", { name: /^Bellwold$/ })).toBeVisible();
    await waitFor(() => expect(window.location.hash).toContain("/info/codex/atlas"));
  });

  it("shows search suggestions, opens full results, and dismisses search with Escape", async () => {
    render(<CodexScreen />);
    const search = screen.getByRole("textbox", { name: "Search articles" });
    fireEvent.change(search, { target: { value: "Bellwold" } });

    const suggestions = screen.getByRole("listbox", { name: "Search suggestions" });
    expect(within(suggestions).getAllByRole("option").length).toBeGreaterThan(1);
    expect(within(suggestions).getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: /See all results/ }));
    expect(await screen.findByRole("heading", { name: "“Bellwold”" })).toBeVisible();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(await screen.findByRole("heading", { name: /A world, carefully remembered/ })).toBeVisible();
    expect(search).toHaveValue("");

    fireEvent.change(search, { target: { value: "no entry can match this phrase" } });
    expect(screen.getByText("No entries match that phrase.")).toBeVisible();
    search.blur();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(search);
  });

  it("clears and blurs search with Escape while staying on the index", () => {
    render(<CodexScreen />);
    const search = screen.getByRole("textbox", { name: "Search articles" });
    fireEvent.change(search, { target: { value: "Bellwold" } });
    search.focus();

    fireEvent.keyDown(search, { key: "Escape" });

    expect(search).toHaveValue("");
    expect(document.activeElement).not.toBe(search);
    expect(window.location.hash).toBe("#/info/codex");
  });

  it("browses category results and provides recovery for unknown archive paths", async () => {
    window.location.hash = "#/info/codex/explore";
    const view = render(<CodexScreen />);
    expect(await screen.findByRole("heading", { name: "Explore the records" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("link", { name: /Geography & places/ })[0]);
    expect(await screen.findByRole("heading", { name: "Geography & places" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Bellwold Roadside Wildlife" })).toBeVisible();

    view.unmount();
    window.location.hash = "#/info/codex/category/not-in-the-index";
    const unknownCategory = render(<CodexScreen />);
    expect(await screen.findByRole("heading", { name: "This category is not in the index" })).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: /Browse all sections/ }));
    expect(await screen.findByRole("heading", { name: "Explore the records" })).toBeVisible();

    unknownCategory.unmount();
    window.location.hash = "#/info/codex/article/not-a-record";
    render(<CodexScreen />);
    expect(await screen.findByRole("heading", { name: "This record is missing" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Return to the index/ })).toHaveAttribute("href", "#/info/codex/explore");
  });

  it("shows a recovery page for an unknown Codex section", async () => {
    window.location.hash = "#/info/codex/unknown-section";
    render(<CodexScreen />);

    expect(await screen.findByRole("heading", { name: "This archive path is unknown" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Return to the index/ })).toHaveAttribute("href", "#/info/codex");
  });

  it("builds article contents links from markdown headings", async () => {
    window.location.hash = "#/info/codex/article/bellwold-roadside-wildlife";
    render(<CodexScreen />);

    expect(await screen.findByRole("heading", { name: "Bellwold Roadside Wildlife" })).toBeVisible();
    const tableOfContents = screen.getByRole("heading", { name: "In this record" }).parentElement;
    expect(tableOfContents).not.toBeNull();
    expect(within(tableOfContents as HTMLElement).getByRole("link", { name: "Stray hounds" }))
      .toHaveAttribute("href", "#stray-hounds");
    expect(screen.getByRole("heading", { name: "Stray hounds", level: 3 })).toBeVisible();
  });

  it("renders second-level article headings with stable anchor ids", async () => {
    const article = ORRAVETH_ARTICLES_BY_SLUG.get("bellwold-roadside-wildlife")!;
    const originalBody = article.body;
    article.body = "## Trail signs\n\nThe tracks are easiest to read after rain.";
    window.location.hash = "#/info/codex/article/bellwold-roadside-wildlife";

    try {
      render(<CodexScreen />);
      const heading = await screen.findByRole("heading", { level: 2, name: "Trail signs" });
      expect(heading).toHaveAttribute("id", "trail-signs");
    } finally {
      article.body = originalBody;
    }
  });

  it("shows the empty timeline state and recorded relationship rows", async () => {
    window.location.hash = "#/info/codex/timeline";
    const timeline = render(<CodexScreen />);
    expect(await screen.findByRole("heading", { name: "History in sequence" })).toBeVisible();
    expect(screen.getByRole("link", { name: "The Age of Measures" })).toBeVisible();

    timeline.unmount();
    window.location.hash = "#/info/codex/relationships";
    render(<CodexScreen />);
    expect(await screen.findByRole("heading", { name: "Relationship index" })).toBeVisible();
    expect(document.querySelectorAll(".codex-relations > div").length).toBeGreaterThan(0);
  });
});
