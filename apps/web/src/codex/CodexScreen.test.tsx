import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import CodexScreen from "./CodexScreen.js";

describe("CodexScreen", () => {
  beforeEach(() => {
    window.location.hash = "#/info/codex";
  });

  it("opens on the Orraveth index with the archive sections", () => {
    render(<CodexScreen />);
    expect(screen.getByRole("heading", { name: /A world, carefullyremembered/ })).toBeVisible();
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
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    await screen.findByRole("heading", { name: "Professor Elira Venn" });
    expect(screen.getByText("Established Canon")).toBeVisible();
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
    expect(screen.getByRole("link", { name: "Bellwold", exact: true })).toBeVisible();
    await waitFor(() => expect(window.location.hash).toContain("/info/codex/atlas"));
  });
});
