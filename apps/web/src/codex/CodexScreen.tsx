import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, ArrowRight, BookOpen, Compass, GitBranch,
  Map, Search, ScrollText, Sparkles, TimerReset,
} from "lucide-react";
import { Panel, TextInput } from "@mudd/ui";
import {
  articleHref, expandWikiLinks, ORRAVETH_ARTICLES, ORRAVETH_ARTICLES_BY_ID,
  ORRAVETH_ARTICLES_BY_SLUG, searchCodexArticles,
} from "./content.js";
import { CODEX_CATEGORIES, type CodexArticle } from "./types.js";
import "./codex.css";

type Route =
  | { page: "home" }
  | { page: "explore" }
  | { page: "category"; id: string }
  | { page: "search"; query: string }
  | { page: "article"; slug: string }
  | { page: "timeline" }
  | { page: "atlas" }
  | { page: "relationships" }
  | { page: "unknown"; path: string };

function readRoute(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/info/codex";
  const [path, queryString = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "info" || parts[1] !== "codex") return { page: "unknown", path };
  const sub = parts[2];
  if (!sub) return { page: "home" };
  if (sub === "explore" && parts.length === 3) return { page: "explore" };
  if (sub === "category" && parts[3]) return { page: "category", id: decodeURIComponent(parts[3]) };
  if (sub === "search") return { page: "search", query: new URLSearchParams(queryString).get("q") ?? "" };
  if (sub === "article" && parts[3]) return { page: "article", slug: decodeURIComponent(parts[3]) };
  if (["timeline", "atlas", "relationships"].includes(sub) && parts.length === 3) return { page: sub as "timeline" | "atlas" | "relationships" };
  return { page: "unknown", path };
}

function toSearch(query: string) {
  window.location.hash = `/info/codex/search?q=${encodeURIComponent(query.trim())}`;
}

function titleForCategory(id: string) {
  return CODEX_CATEGORIES.find((category) => category.id === id)?.label;
}

function articleCategory(article: CodexArticle) {
  return titleForCategory(article.category) ?? article.category;
}

function headingId(text: string) {
  return text.toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
}

function headings(markdown: string) {
  return [...markdown.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => ({
    title: match[1].replace(/[*_`]/g, "").trim(),
    level: match[0].match(/^#+/)?.[0].length ?? 2,
  }));
}

function ArticleLink({ article, children }: { article: CodexArticle; children?: ReactNode }) {
  return <a className="codex-article-link" href={articleHref(article.slug)}>{children ?? article.title}<ArrowRight size={15} aria-hidden="true" /></a>;
}

function ArticleCard({ article, index = 0 }: { article: CodexArticle; index?: number }) {
  return (
    <article className="codex-card" style={{ "--card-order": index } as React.CSSProperties}>
      <div className="codex-card-meta"><span>{articleCategory(article)}</span><span className={`codex-canon codex-canon--${article.canonStatus.toLowerCase().replaceAll(" ", "-")}`}>{article.canonStatus}</span></div>
      <h3><ArticleLink article={article} /></h3>
      <p>{article.summary}</p>
      {article.tags.length > 0 && <div className="codex-tags">{article.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
    </article>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="codex-empty"><BookOpen size={24} aria-hidden="true" /><h3>{title}</h3><p>{body}</p></div>;
}

export default function CodexScreen() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [searchText, setSearchText] = useState(() => readRoute().page === "search" ? (readRoute() as Extract<Route, { page: "search" }>).query : "");
  const [activeResult, setActiveResult] = useState(0);

  useEffect(() => {
    const sync = () => {
      const next = readRoute();
      setRoute(next);
      if (next.page === "search") setSearchText(next.query);
      setActiveResult(0);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const routeResults = useMemo(() => route.page === "search" ? searchCodexArticles(route.query) : [], [route]);
  const currentArticle = route.page === "article" ? ORRAVETH_ARTICLES_BY_SLUG.get(route.slug) : undefined;
  const previewResults = useMemo(() => searchText.trim() ? searchCodexArticles(searchText).slice(0, 7) : [], [searchText]);
  const toc = currentArticle ? headings(currentArticle.body) : [];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        (document.getElementById("codex-search") as HTMLInputElement | null)?.focus();
      }
      if (event.key === "Escape" && target?.id === "codex-search") {
        setSearchText("");
        if (route.page === "search") window.location.hash = "/info/codex";
        else (document.getElementById("codex-search") as HTMLInputElement | null)?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [route]);

  const linkedArticle = (id: string) => ORRAVETH_ARTICLES_BY_ID.get(id);
  return (
    <div className="codex" aria-label="Orraveth Codex">
      <header className="codex-masthead">
        <a className="codex-wordmark" href="#/info/codex" aria-label="Codex home">
          <span className="codex-seal"><BookOpen size={20} aria-hidden="true" /></span>
          <span><strong>ORRAVETH</strong><small>THE FIELD ARCHIVE</small></span>
        </a>
        <div className="codex-header-note"><span className="codex-live-mark" /> A reference to a world apart</div>
      </header>

      <nav className="codex-nav" aria-label="Codex sections">
        <a href="#/info/codex" aria-current={route.page === "home" ? "page" : undefined}>Index</a>
        <a href="#/info/codex/explore" aria-current={route.page === "explore" || route.page === "category" ? "page" : undefined}><Compass size={15} />Explore</a>
        <a href="#/info/codex/timeline" aria-current={route.page === "timeline" ? "page" : undefined}><TimerReset size={15} />Timeline</a>
        <a href="#/info/codex/atlas" aria-current={route.page === "atlas" ? "page" : undefined}><Map size={15} />Regions</a>
        <a href="#/info/codex/relationships" aria-current={route.page === "relationships" ? "page" : undefined}><GitBranch size={15} />Connections</a>
      </nav>

      <section className="codex-search-wrap" aria-label="Search the archive">
        <Search size={18} aria-hidden="true" />
        <TextInput id="codex-search" label="Search articles" placeholder="Search names, places, ideas…" value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onKeyDown={(event) => {
            if (route.page === "search" && routeResults.length && event.key === "ArrowDown") { event.preventDefault(); setActiveResult((value) => Math.min(value + 1, routeResults.length - 1)); }
            else if (route.page === "search" && routeResults.length && event.key === "ArrowUp") { event.preventDefault(); setActiveResult((value) => Math.max(value - 1, 0)); }
            else if (route.page === "search" && routeResults.length && event.key === "Enter") { event.preventDefault(); window.location.hash = articleHref(routeResults[activeResult].slug).slice(1); }
            else if (event.key === "Enter") { event.preventDefault(); toSearch(searchText); }
            if (event.key === "ArrowDown" && previewResults.length && route.page !== "search") { event.preventDefault(); toSearch(searchText); }
          }} />
        <kbd>/</kbd>
        {searchText.trim() && route.page !== "search" && <div className="codex-search-popover" role="listbox" aria-label="Search suggestions">
          {previewResults.length ? previewResults.map((article, index) => <a role="option" aria-selected={index === 0} key={article.id} href={articleHref(article.slug)}><span>{article.title}</span><small>{articleCategory(article)}</small></a>) : <p>No entries match that phrase.</p>}
          <button type="button" onClick={() => toSearch(searchText)}>See all results <ArrowRight size={14} /></button>
        </div>}
      </section>

      {route.page === "home" && <div className="codex-page codex-home">
        <div className="codex-hero">
          <div className="codex-hero-copy">
            <p className="codex-kicker"><span>VOL. I</span> &nbsp;·&nbsp; AN INDEPENDENT ARCHIVE</p>
            <h1 aria-label="A world, carefully remembered.">A world, <em>carefully</em><br />remembered.</h1>
            <p className="codex-lede">A field guide to Orraveth: its places, peoples, beliefs, and the histories that still shape the present.</p>
            <a className="codex-primary-link" href="#/info/codex/explore">Open the index <ArrowRight size={17} /></a>
          </div>
          <div className="codex-hero-art" aria-hidden="true">
            <div className="codex-orbit codex-orbit-one" /><div className="codex-orbit codex-orbit-two" />
            <div className="codex-compass-rose"><span>N</span><i /><b /><small>ORRAVETH<br />FIELD NOTES</small></div>
            <div className="codex-hero-caption">FIELD PLATE 01 <span>—</span> THE KNOWN WORLD</div>
          </div>
        </div>
        <div className="codex-statline"><span><strong>{ORRAVETH_ARTICLES.length}</strong> catalogued entries</span><span>Updated from the archive <b>·</b> {ORRAVETH_ARTICLES.length ? [...ORRAVETH_ARTICLES].sort((a,b) => b.lastUpdated.localeCompare(a.lastUpdated))[0].lastUpdated : "—"}</span></div>
        <div className="codex-section-heading"><div><p className="codex-kicker">A PLACE TO BEGIN</p><h2>Browse the records</h2></div><a href="#/info/codex/explore">Full index <ArrowRight size={15} /></a></div>
        <div className="codex-category-grid">
          {CODEX_CATEGORIES.map((category, index) => {
            const count = ORRAVETH_ARTICLES.filter((article) => article.category === category.id).length;
            return <a className="codex-category" key={category.id} href={`#/info/codex/category/${category.id}`} style={{ "--card-order": index } as React.CSSProperties}><span className="codex-category-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{category.label}</strong><small>{count} {count === 1 ? "entry" : "entries"}</small></span><ArrowRight size={16} /></a>;
          })}
        </div>
        <section className="codex-featured">
          <div className="codex-section-heading"><div><p className="codex-kicker">FROM THE SHELVES</p><h2>Worth knowing</h2></div><Sparkles size={19} aria-hidden="true" /></div>
          {ORRAVETH_ARTICLES.length ? <div className="codex-card-grid">{ORRAVETH_ARTICLES.slice(0, 3).map((article, i) => <ArticleCard article={article} index={i} key={article.id} />)}</div> : <EmptyState title="The shelves are quiet" body="No entries have been catalogued yet." />}
        </section>
      </div>}

      {(route.page === "explore" || route.page === "category") && (() => {
        const category = route.page === "category" ? titleForCategory(route.id) : undefined;
        const articles = route.page === "category" ? ORRAVETH_ARTICLES.filter((article) => article.category === route.id) : ORRAVETH_ARTICLES;
        if (route.page === "category" && !category) return <div className="codex-page"><div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /><span>Unknown category</span></div><EmptyState title="This category is not in the index" body={`No archive section is filed as “${route.id}”. Browse the complete index to continue.`} /><p className="codex-back-home"><a href="#/info/codex/explore"><ArrowLeft size={16} /> Browse all sections</a></p></div>;
        return <div className="codex-page">
          <div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /> <span>{category ?? "Explore the index"}</span></div>
          <div className="codex-page-title"><p className="codex-kicker">THE INDEX</p><h1>{category ?? "Explore the records"}</h1><p>{articles.length} {articles.length === 1 ? "record" : "records"} held in this section.</p></div>
          {route.page === "explore" && <div className="codex-pills">{CODEX_CATEGORIES.map((item) => <a href={`#/info/codex/category/${item.id}`} key={item.id}>{item.label}<span>{ORRAVETH_ARTICLES.filter((a) => a.category === item.id).length}</span></a>)}</div>}
          {!category && <div className="codex-index-list">{CODEX_CATEGORIES.map((item) => {
            const entries = ORRAVETH_ARTICLES.filter((article) => article.category === item.id);
            return entries.length ? <section key={item.id}><h2><a href={`#/info/codex/category/${item.id}`}>{item.label}<ArrowRight size={15} /></a><small>{entries.length}</small></h2><div className="codex-card-grid">{entries.map((article, index) => <ArticleCard article={article} index={index} key={article.id} />)}</div></section> : null;
          })}</div>}
          {category && (articles.length ? <div className="codex-card-grid">{articles.map((article, index) => <ArticleCard article={article} index={index} key={article.id} />)}</div> : <EmptyState title="No records in this section" body="The archive has no entries filed here yet." />)}
        </div>;
      })()}

      {route.page === "search" && <div className="codex-page">
        <div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /><span>Search</span></div>
        <div className="codex-page-title"><p className="codex-kicker">SEARCH THE ARCHIVE</p><h1>“{route.query || "…"}”</h1><p>{routeResults.length} {routeResults.length === 1 ? "matching record" : "matching records"}</p></div>
        {routeResults.length ? <div className="codex-search-results" role="listbox" aria-label="Search results">{routeResults.map((article, index) => <div role="option" aria-selected={activeResult === index} className="codex-result" key={article.id}><span className="codex-result-index">{String(index + 1).padStart(2, "0")}</span><div><h2><ArticleLink article={article} /></h2><p>{article.summary}</p><small>{articleCategory(article)} · {article.canonStatus}</small></div></div>)}</div> : <EmptyState title="No matching records" body="Try another spelling, a shorter phrase, or a related term." />}
      </div>}

      {route.page === "article" && <div className="codex-page codex-reading">
        {!currentArticle ? <><div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /><span>Record not found</span></div><EmptyState title="This record is missing" body={`No article was found for “${route.slug}”. It may have been renamed or removed from the archive.`} /><p className="codex-back-home"><a href="#/info/codex/explore"><ArrowLeft size={16} /> Return to the index</a></p></> : <>
          <div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /><a href={`#/info/codex/category/${currentArticle.category}`}>{articleCategory(currentArticle)}</a><ArrowRight size={13} /><span>{currentArticle.title}</span></div>
          <div className="codex-article-heading"><p className="codex-kicker">{articleCategory(currentArticle)} <span>·</span> {currentArticle.entityType}</p><h1>{currentArticle.title}</h1><p className="codex-article-summary">{currentArticle.summary}</p><div className="codex-article-meta"><span className={`codex-canon codex-canon--${currentArticle.canonStatus.toLowerCase().replaceAll(" ", "-")}`}>{currentArticle.canonStatus}</span><span>Last revised {currentArticle.lastUpdated}</span></div></div>
          <div className="codex-reading-layout"><article className="codex-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            h2: ({ children }) => <h2 id={headingId(String(children))}>{children}</h2>,
            h3: ({ children }) => <h3 id={headingId(String(children))}>{children}</h3>,
            a: ({ href, children }) => <a href={href}>{children}</a>,
          }}>{expandWikiLinks(currentArticle.body)}</ReactMarkdown></article>
            <aside className="codex-article-aside">
              {toc.length > 0 && <Panel className="codex-aside-panel" title="In this record"><ol className="codex-toc">{toc.map((item, index) => <li className={item.level === 3 ? "codex-toc-sub" : ""} key={`${item.title}-${index}`}><a href={`#${headingId(item.title)}`}>{item.title}</a></li>)}</ol></Panel>}
              <Panel className="codex-aside-panel" title="Record details"><p>Filed under <a href={`#/info/codex/category/${currentArticle.category}`}>{articleCategory(currentArticle)}</a></p><p>Source trail: {currentArticle.sourceRefs.length ? "Supplied Orraveth worldbuilding brief" : "Not recorded"}</p>{currentArticle.claims.length > 0 && <div className="codex-claims"><h3>Notes on certainty</h3>{currentArticle.claims.map((claim, index) => <blockquote key={index}><span>{claim.epistemicStatus}</span><p>{claim.text}</p>{claim.attribution && <cite>— {claim.attribution}</cite>}</blockquote>)}</div>}</Panel>
            </aside>
          </div>
          {(() => {
            const related = [...new Set([...currentArticle.relatedIds, ...currentArticle.relationships.map((relation) => relation.targetId)])].map(linkedArticle).filter((item): item is CodexArticle => Boolean(item));
            return <section className="codex-related"><div className="codex-section-heading"><div><p className="codex-kicker">FOLLOW THE THREADS</p><h2>Related records</h2></div></div>{related.length ? <div className="codex-card-grid">{related.map((article, index) => <ArticleCard article={article} index={index} key={article.id} />)}</div> : <p className="codex-muted">No related records are listed.</p>}</section>;
          })()}
        </>}
      </div>}

      {route.page === "timeline" && <div className="codex-page">
        <div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /><span>Timeline</span></div>
        <div className="codex-page-title"><p className="codex-kicker">A CHRONOLOGY, WITH CAVEATS</p><h1>History in sequence</h1><p>Ordered by the archive’s own chronology. Uncertain dates remain uncertain.</p></div>
        {(() => { const items = ORRAVETH_ARTICLES.filter((article) => article.timeline).sort((a,b) => (a.timeline?.order ?? 0) - (b.timeline?.order ?? 0)); return items.length ? <ol className="codex-timeline">{items.map((article) => <li key={article.id}><span className="codex-timeline-marker" /><div className="codex-time-label">{article.timeline?.label}<small>{article.timeline?.precision}</small></div><div className="codex-timeline-entry"><h2><ArticleLink article={article} /></h2><p>{article.summary}</p></div></li>)}</ol> : <EmptyState title="No dated records yet" body="Timeline entries appear here when the archive assigns an order." />; })()}
      </div>}

      {route.page === "atlas" && <div className="codex-page">
        <div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /><span>Region directory</span></div>
        <div className="codex-page-title"><p className="codex-kicker">A DIRECTORY, NOT A MAP</p><h1>Regions & places</h1><p>Entries are grouped by the region references in the records. No coordinates are implied.</p></div>
        {(() => { const regions = ORRAVETH_ARTICLES.filter((article) => article.entityType === "region"); return regions.length ? <div className="codex-region-list">{regions.map((region) => { const places = ORRAVETH_ARTICLES.filter((article) => article.regionId === region.id); return <section key={region.id}><div><span className="codex-region-mark"><Map size={17} /></span><div><h2><ArticleLink article={region} /></h2><p>{region.summary}</p></div></div>{places.length > 0 && <ul>{places.map((place) => <li key={place.id}><ArticleLink article={place} /><span>{place.entityType}</span></li>)}</ul>}</section>; })}</div> : <EmptyState title="No regions catalogued" body="A directory entry will appear when the archive identifies a region." />; })()}
        <section className="codex-unassigned"><h2>Places without a region reference</h2>{ORRAVETH_ARTICLES.filter((article) => ["location", "region"].includes(article.entityType) && !article.regionId && article.entityType !== "region").length ? <ul>{ORRAVETH_ARTICLES.filter((article) => article.entityType === "location" && !article.regionId).map((place) => <li key={place.id}><ArticleLink article={place} /></li>)}</ul> : <p>No unassigned place records.</p>}</section>
      </div>}

      {route.page === "relationships" && <div className="codex-page">
        <div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /><span>Connections</span></div>
        <div className="codex-page-title"><p className="codex-kicker">THE THREADS BETWEEN RECORDS</p><h1>Relationship index</h1><p>Connections are presented as recorded, not inferred.</p></div>
        {(() => { const rows = ORRAVETH_ARTICLES.flatMap((article) => article.relationships.map((relation, index) => ({ article, relation, index }))); return rows.length ? <div className="codex-relations">{rows.map(({ article, relation, index }) => { const target = linkedArticle(relation.targetId); return <div key={`${article.id}-${index}`}><span>{target ? <a href={articleHref(target.slug)}>{target.title}</a> : relation.targetId}</span><b>{relation.label ?? relation.type.replaceAll("-", " ")}</b><span><a href={articleHref(article.slug)}>{article.title}</a></span></div>; })}</div> : <EmptyState title="No explicit links recorded" body="Relationships will be listed here when the source records identify them." />; })()}
      </div>}

      {route.page === "unknown" && <div className="codex-page"><div className="codex-breadcrumb"><a href="#/info/codex">Archive</a><ArrowRight size={13} /><span>Unknown page</span></div><EmptyState title="This archive path is unknown" body={`No Codex section exists at ${route.path}. Return to the index to continue.`} /><p className="codex-back-home"><a href="#/info/codex"><ArrowLeft size={16} /> Return to the index</a></p></div>}

      <footer className="codex-footer"><span><ScrollText size={15} /> THE ORRAVETH FIELD ARCHIVE</span><span>Orraveth is separate from the active MUDD world.</span></footer>
    </div>
  );
}
