import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { ArrowDown, ArrowRight, BookOpen, Compass, Feather, Map, MessageSquareText, Shield, Sparkles } from 'lucide-react';
import './public-home.css';

export function PublicHomePage() {
  const { isSignedIn } = useUser();
  return <div className="mudd-home">
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero__copy">
        <p className="home-kicker"><span aria-hidden="true" /> A shared world, written one step at a time</p>
        <h1 id="home-title">The road begins<br /><em>where the map ends.</em></h1>
        <p className="home-hero__lede">MUDD is a text-first fantasy RPG about finding your way through living worlds. Read the place. Choose what to do. Leave a story behind.</p>
        <div className="home-actions">
          <Link className="home-button home-button--primary" href="/worlds">Find your world <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className="home-button home-button--quiet" href={isSignedIn ? '/worlds' : '/sign-in'}>Continue your journey</Link>
        </div>
        <div className="home-hero__note"><span className="home-rule" /> No route to memorize. Just a place, and your next choice.</div>
      </div>
      <div className="home-hero__art" aria-label="Illustrated frontier map with a winding road, hills, and a distant watchtower" role="img">
        <div className="home-map">
          <span className="map-coordinate map-coordinate--top">N 04° · THE OPEN COUNTRY</span>
          <svg viewBox="0 0 680 600" aria-hidden="true">
            <defs>
              <pattern id="home-grid" width="34" height="34" patternUnits="userSpaceOnUse">
                <path d="M34 0H0V34" fill="none" stroke="currentColor" strokeOpacity=".08" strokeWidth="1" />
              </pattern>
              <linearGradient id="home-land" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#d9c99f" />
                <stop offset="1" stopColor="#a3ab83" />
              </linearGradient>
            </defs>
            <path className="map-land" d="M36 83Q153 16 282 63t211-4q89-48 151 24v418q-92 37-185 7t-211 35q-125 31-212-45Z" fill="url(#home-land)" />
            <path d="M36 83Q153 16 282 63t211-4q89-48 151 24v418q-92 37-185 7t-211 35q-125 31-212-45Z" fill="url(#home-grid)" />
            <path className="map-contour" d="M75 169q72-65 150-28t132 2q92-21 168 37t96 7M62 214q81-68 167-29t133 6q85-19 149 33t94 4M48 264q93-66 179-27t126 12q84-13 148 34t99 16M52 355q77-49 150-20t135 4q84-8 152 36t104 22M52 406q75-44 151-13t130 9q83-5 153 35t103 27" fill="none" />
            <path className="map-river" d="M514 87q-43 52-57 109t-67 88q-53 31-61 83t-84 87q-53 25-78 75" fill="none" />
            <path className="map-road" d="M141 483q20-58 79-91t102-53q56-32 60-84t61-85q34-18 59-72" fill="none" />
            <path className="map-road-highlight" d="M141 483q20-58 79-91t102-53q56-32 60-84t61-85q34-18 59-72" fill="none" />
            <g className="map-tower" transform="translate(502 87)">
              <path d="M-18 10h36l-4-32h-28z" /><path d="M-12-22v-11h24v11M-4-9v8h8v-8" /><path d="M-24 10h48" />
            </g>
            <g className="map-pines" transform="translate(178 210)">
              <path d="M0 0l-12 24h24zM0 13l-10 21h20zM0 24v13M30 10L18 34h24zM30 23L20 44h20zM30 34v11M-28 22l-10 19h20zM-28 32l-9 19h18zM-28 41v10" />
            </g>
            <g className="map-pines" transform="translate(405 355)">
              <path d="M0 0l-12 24h24zM0 13l-10 21h20zM0 24v13M30 10L18 34h24zM30 23L20 44h20zM30 34v11M-28 22l-10 19h20zM-28 32l-9 19h18zM-28 41v10" />
            </g>
            <g className="map-marker" transform="translate(278 333)">
              <circle r="11" /><circle r="3" /><path d="M0-13v-20" />
            </g>
            <text className="map-label" x="465" y="136">WATCHTOWER</text>
            <text className="map-label map-label--small" x="80" y="126">OPEN COUNTRY</text>
            <text className="map-label map-label--small" x="424" y="448">PINE GROVE</text>
            <text className="map-label" x="87" y="522">YOU ARE HERE</text>
          </svg>
          <span className="map-coordinate map-coordinate--bottom">FIELD NOTES / 01</span>
          <span className="map-compass" aria-hidden="true"><span>N</span><i /></span>
        </div>
        <p className="home-art-caption"><span>01</span> A frontier is not a destination. It is a question.</p>
      </div>
      <a className="home-scroll" href="#how-it-works" aria-label="Scroll to discover how MUDD works"><ArrowDown size={16} aria-hidden="true" /> Follow the trail</a>
    </section>

    <section className="home-intro" id="how-it-works" aria-labelledby="intro-title">
      <div className="home-section-index">01 <span>—</span> THE WAY IN</div>
      <div className="home-intro__body">
        <h2 id="intro-title">A world in words.<br /><em>A life of your own.</em></h2>
        <p>Somewhere beyond the familiar road, the world is already there: weather moving over the hills, doors left open, people with reasons to be where they are. You meet it through prose, then answer in your own words.</p>
        <Link className="home-text-link" href="/worlds">Step into a world <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      <div className="home-intro__aside"><span className="home-quote-mark">“</span><p>The world tells you what is here.<br />You decide what matters.</p><span className="home-quote-byline">THE MUDD WAY</span></div>
    </section>

    <section className="home-reading" aria-labelledby="reading-title">
      <div className="home-reading__heading">
        <div className="home-section-index">02 <span>—</span> AT THE EDGE OF THE PAGE</div>
        <h2 id="reading-title">Read the room.<br /><em>Then make a move.</em></h2>
        <p>No maze of menus between you and the story. MUDD is built around the oldest interface in the world: language.</p>
      </div>
      <div className="home-reading__scene">
        <div className="scene-topline"><span><BookOpen size={15} aria-hidden="true" /> FIELD JOURNAL</span><span>AN EXAMPLE OF PLAY</span></div>
        <div className="scene-prose">
          <p className="scene-location">AT THE OLD MILESTONE</p>
          <p>The track narrows where the pines lean close. A weathered milestone stands in the grass, its carved face turned toward the west. Beyond it, a thin line of smoke unwinds above the trees.</p>
          <p className="scene-prompt">What do you do?</p>
        </div>
        <div className="scene-command"><span className="scene-chevron" aria-hidden="true">›</span><span>look at the milestone</span><span className="scene-cursor" aria-hidden="true" /></div>
        <div className="scene-foot"><span>Words are actions here.</span><span>YOUR TURN</span></div>
      </div>
      <div className="home-reading__marginalia"><span className="marginalia-line" /><p>Not a choice wheel.<br />Not a cutscene.<br /><em>Your own next sentence.</em></p></div>
    </section>

    <section className="home-pillars" aria-label="What makes a MUDD story">
      <article className="home-pillar">
        <span className="home-pillar__number">A</span><Compass size={21} strokeWidth={1.4} aria-hidden="true" />
        <h3>Places worth getting lost in</h3>
        <p>Worlds are authored with their own histories, textures, and hidden corners. Curiosity is a good compass.</p>
      </article>
      <article className="home-pillar home-pillar--featured">
        <span className="home-pillar__number">B</span><Feather size={21} strokeWidth={1.4} aria-hidden="true" />
        <h3>A character who stays yours</h3>
        <p>Your traveler persists as you explore. The choices you make belong to that character and their journey.</p>
      </article>
      <article className="home-pillar">
        <span className="home-pillar__number">C</span><MessageSquareText size={21} strokeWidth={1.4} aria-hidden="true" />
        <h3>Stories made in company</h3>
        <p>Shared worlds give your travels a sense of place among other people, without asking you to play the same way.</p>
      </article>
    </section>

    <section className="home-codex" aria-labelledby="codex-title">
      <div className="home-codex__stamp"><Map size={25} strokeWidth={1.25} aria-hidden="true" /><span>KEEP<br />LOOKING</span></div>
      <div>
        <div className="home-section-index">03 <span>—</span> NOTES FROM THE ROAD</div>
        <h2 id="codex-title">Wonder likes<br /><em>a little context.</em></h2>
        <p>Meet the people, places, and ideas that give a world its shape. The Codex is there when you want to learn more—and easy to leave closed when you would rather find out for yourself.</p>
        <Link className="home-text-link" href="/codex">Open the Codex <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      <div className="home-codex__note" aria-hidden="true">
        <span className="note-line note-line--short" /><span className="note-line" /><span className="note-line note-line--long" />
        <span className="note-seal"><Sparkles size={17} strokeWidth={1.3} /></span>
      </div>
    </section>

    <section className="home-safety" aria-label="A welcoming place to begin">
      <div className="home-safety__icon"><Shield size={20} strokeWidth={1.5} aria-hidden="true" /></div>
      <div><p className="home-safety__title">Start small. Stay as long as you like.</p><p>MUDD is designed to be explored at your pace. Read a little, try a command, and see where the story opens.</p></div>
      <Link href="/worlds" aria-label="Browse worlds"><ArrowRight size={19} aria-hidden="true" /></Link>
    </section>

    <section className="home-final" aria-labelledby="final-title">
      <span className="home-final__eyebrow">THE TRAIL IS OPEN</span>
      <h2 id="final-title">You don’t need to know<br />the way <em>before you go.</em></h2>
      <p>Pick a world. Make a traveler. Begin with what is in front of you.</p>
      <div className="home-actions">
        <Link className="home-button home-button--light" href="/worlds">Browse worlds <ArrowRight size={17} aria-hidden="true" /></Link>
        <Link className="home-final__secondary" href="/sign-in">Already have a character? Sign in</Link>
      </div>
      <div className="home-final__ornament" aria-hidden="true"><span /><span /><span /></div>
    </section>
    <footer className="home-footer"><span>MUDD <i>·</i> STORIES IN SHARED WORLDS</span><Link href="/codex">A little more about the world <ArrowRight size={13} aria-hidden="true" /></Link></footer>
  </div>;
}
