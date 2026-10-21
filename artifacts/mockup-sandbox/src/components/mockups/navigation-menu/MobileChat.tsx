import { useRef, useState, type FormEvent } from "react";
import { Compass, Keyboard, Maximize2, Menu, Moon, NotebookText, Sun, UserRound, Users, X, Send, ChevronUp } from "lucide-react";
import "./_group.css";
import "./MobileChat.css";

type ChatMessage = {
  id: number;
  speaker: string;
  text: string;
  kind?: "npc" | "self";
};

const initialMessages: ChatMessage[] = [
  { id: 1, speaker: "Mara", text: "The river is higher than it was at dawn. Keep to the center stones." , kind: "npc" },
  { id: 2, speaker: "Bram", text: "I can see the old watchtower from here. Is that the north road?" },
  { id: 3, speaker: "You", text: "The path through the trees, yes. It meets the road just past the mill.", kind: "self" },
  { id: 4, speaker: "Mara", text: "Mind the loose boards near the eastern rail.", kind: "npc" },
];

export function MobileChat() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(true);
  const [darkTheme, setDarkTheme] = useState(true);
  const [commandDraft, setCommandDraft] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [messages, setMessages] = useState(initialMessages);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const chooseCommand = (command: string) => {
    setTypeOpen(true);
    setCommandDraft(command);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: Date.now(), speaker: "You", text, kind: "self" }]);
    setChatDraft("");
    requestAnimationFrame(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
  };

  return (
    <main className={`mudd-nav-preview mobile-chat${darkTheme ? "" : " mobile-chat--light"}`}>
      <section className="mudd-nav-preview__content mobile-chat__content" aria-label="Play screen">
        <article className="mudd-nav-preview__terminal mobile-chat__terminal">
          <header className="mudd-nav-preview__room-header mobile-chat__room-header">
            <div className="mobile-chat__title-group">
              <span className="mobile-chat__eyebrow">RIVERLANDS · 14:32</span>
              <h1>Glasswater Bridge</h1>
            </div>
          </header>
          <div className="mobile-chat__presence"><Users size={13} aria-hidden="true" /><span>Here now: Mara, Bram</span><i aria-label="Connected" /></div>
          <div className="mudd-nav-preview__history mobile-chat__history" aria-label="Terminal output" role="region" tabIndex={0}>
            <p><span>14:29 · south</span><strong>A Paved Street</strong>The paved street runs between a round stone temple to the west and the city barracks to the east.</p>
            <p>The street turns into a path further north, cutting between homes before vanishing into a green forest.</p>
            <p className="mudd-nav-preview__muted">[exits: N · S]</p>
            <p><u>A guard of the Town Watch patrols the area, eyes alert.</u></p>
            <p><span>14:31 · look</span><strong>Glasswater Bridge</strong>Rain-dark stone arches over the slow river. A weathered marker points north toward Willowrest.</p>
          </div>
          <div className="mobile-chat__quick" role="group" aria-label="Quick commands">
            <button type="button" onClick={() => chooseCommand("look")}>look</button>
            <button type="button" onClick={() => chooseCommand("go north")}>go north</button>
            <button type="button" onClick={() => chooseCommand("talk Mara")}>talk</button>
            <button type="button" onClick={() => chooseCommand("read marker")}>read</button>
          </div>
          <section className={`mobile-chat__room-chat${chatCollapsed ? " mobile-chat__room-chat--collapsed" : ""}${chatFullscreen ? " mobile-chat__room-chat--fullscreen" : ""}`} aria-label="Room chat">
            <header className="mobile-chat__chat-header">
              <h2>Room chat</h2>
              <span><i /> LIVE</span>
              <button type="button" aria-label={chatCollapsed ? "Expand room chat" : "Collapse room chat"} aria-expanded={!chatCollapsed} onClick={() => setChatCollapsed((collapsed) => !collapsed)}><ChevronUp size={16} aria-hidden="true" /></button>
              <button type="button" aria-label={chatFullscreen ? "Close room chat full screen" : "Open room chat full screen"} onClick={() => setChatFullscreen((open) => !open)}>
                {chatFullscreen ? <X size={16} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
              </button>
            </header>
            {!chatCollapsed && <>
              <div className="mobile-chat__messages" ref={messagesRef} role="log" aria-label="Room chat messages" aria-live="polite" aria-relevant="additions" tabIndex={0}>
                <div className="mobile-chat__day">TODAY · GLASSWATER BRIDGE</div>
                {messages.map((message) => (
                  <div className={`mobile-chat__message${message.kind ? ` mobile-chat__message--${message.kind}` : ""}`} key={message.id}>
                    <span className="mobile-chat__speaker">{message.speaker}</span>
                    <p>{message.text}</p>
                  </div>
                ))}
              </div>
              <form className="mobile-chat__chat-composer" onSubmit={sendMessage}>
                <input aria-label="Message the room" placeholder="Message the room" value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} maxLength={500} autoComplete="off" />
                <button type="submit" aria-label="Send room message" disabled={!chatDraft.trim()}><Send size={16} aria-hidden="true" /></button>
              </form>
            </>}
          </section>
          {typeOpen && (
            <form className="mudd-nav-preview__composer mobile-chat__command" onSubmit={(event) => { event.preventDefault(); setCommandDraft(""); }}>
              <span aria-hidden="true">&gt;</span>
              <input ref={inputRef} aria-label="Enter a command" autoComplete="off" spellCheck={false} placeholder="Type a command…" value={commandDraft} onChange={(event) => setCommandDraft(event.target.value)} />
            </form>
          )}
        </article>
      </section>
      <nav className="mudd-nav-preview__tabs mobile-chat__tabs" aria-label="Game screens">
        <button className="mudd-nav-preview__tab mudd-nav-preview__tab--active" type="button" aria-current="page"><Compass aria-hidden="true" /><span>Play</span></button>
        <button className="mudd-nav-preview__tab" type="button"><UserRound aria-hidden="true" /><span>Traveler</span></button>
        <button className="mudd-nav-preview__tab" type="button"><NotebookText aria-hidden="true" /><span>Field notes</span></button>
        <button className={`mudd-nav-preview__tab${typeOpen ? " mudd-nav-preview__tab--active" : ""}`} type="button" aria-pressed={typeOpen} onClick={() => {
          if (typeOpen) {
            inputRef.current?.blur();
            setTypeOpen(false);
            return;
          }
          setMenuOpen(false);
          setTypeOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}>
          <Keyboard aria-hidden="true" /><span>Type</span>
        </button>
        <div className="mudd-nav-preview__menu">
          <button className={`mudd-nav-preview__tab mudd-nav-preview__menu-trigger${menuOpen ? " mudd-nav-preview__tab--active" : ""}`} type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="mudd-mobile-chat-menu" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}<span>Menu</span>
          </button>
          {menuOpen && <div className="mudd-nav-preview__panel" id="mudd-mobile-chat-menu" role="region" aria-label="Menu">
            <div className="mudd-nav-preview__brand"><span className="mudd-nav-preview__brand-mark" aria-hidden="true" /><span>MUDD</span></div>
            <button className="mudd-nav-preview__action" type="button"><Users size={18} aria-hidden="true" /><span>Characters</span></button>
            <button className="mudd-nav-preview__action" type="button" onClick={() => setDarkTheme((dark) => !dark)}>
              {darkTheme ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              <span>Switch to {darkTheme ? "light" : "dark"} theme</span>
            </button>
          </div>}
        </div>
      </nav>
    </main>
  );
}
