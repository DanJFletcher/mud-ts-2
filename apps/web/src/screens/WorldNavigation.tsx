import {
  type GameSnapshot
} from "@mudd/client-sdk";
import type { InteractionInbox } from "@mudd/contracts";
import {
  Button
} from "@mudd/ui";
import { Compass, Info as InfoIcon, Keyboard, Menu, Moon, Sun, Users, X } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Screen } from "../features/navigation/world-navigation.js";
import { PwaInstallAction } from "../lobby/PwaInstallAction.js";

export interface WorldNavigationProps {
  navigation: {
    screen: Screen;
    setMenuOpen: Dispatch<SetStateAction<boolean>>;
    navMenuRef: RefObject<HTMLDivElement | null>;
    navMenuTriggerRef: RefObject<HTMLButtonElement | null>;
    menuOpen: boolean;
    toggleTheme: () => void;
    theme: "light" | "dark";
  };
  actions: {
    handleLeaveWorld: () => Promise<void>;
    leaving: boolean;
  };
  commandInput: {
    mobileCommandInputOpen: boolean;
    setMobileCommandInputOpen: Dispatch<SetStateAction<boolean>>;
    setTerminalExpandRequest: Dispatch<SetStateAction<number>>;
  };
  view: {
    snapshot: GameSnapshot | null;
    isAnyCombatActive: boolean;
    visiblePvp: InteractionInbox["encounter"] | undefined;
  };
}
export function WorldNavigation({ navigation, actions, commandInput, view }: WorldNavigationProps) {
  const { screen, setMenuOpen, navMenuRef, navMenuTriggerRef, menuOpen, toggleTheme, theme } = navigation;
  const { handleLeaveWorld, leaving } = actions;
  const { mobileCommandInputOpen, setMobileCommandInputOpen, setTerminalExpandRequest } = commandInput;
  const { snapshot, isAnyCombatActive, visiblePvp } = view;
  return (<nav
    className={`focused-bottom-nav${screen === "play" && snapshot?.location && !isAnyCombatActive && !visiblePvp ? " focused-bottom-nav--with-type" : ""}`}
    aria-label="Game screens"
  >
    <a href="#/play" className="focused-tab" aria-current={screen === "play" ? "page" : undefined} onClick={() => setMenuOpen(false)}><Compass aria-hidden="true" /><span>Play</span></a>
    <a href="#/info" className="focused-tab" aria-current={screen !== "play" ? "page" : undefined} onClick={() => setMenuOpen(false)}><InfoIcon aria-hidden="true" /><span>Info</span></a>
    {screen === "play" && snapshot?.location && !isAnyCombatActive && !visiblePvp && (
      <button
        className="focused-tab focused-type-tab"
        type="button"
        aria-pressed={mobileCommandInputOpen}
        onClick={() => {
          if (mobileCommandInputOpen) {
            document.getElementById("focused-world-command")?.blur();
            setMobileCommandInputOpen(false);
            return;
          }
          setTerminalExpandRequest((request) => request + 1);
          setMenuOpen(false);
          setMobileCommandInputOpen(true);
        }}
      >
        <Keyboard aria-hidden="true" /><span>Type</span>
      </button>
    )}
    <div className="focused-nav-menu" ref={navMenuRef}>
      <button
        ref={navMenuTriggerRef}
        className="focused-tab focused-nav-menu__trigger"
        type="button"
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        aria-controls="focused-nav-menu-panel"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        <span>Menu</span>
      </button>
      <div
        id="focused-nav-menu-panel"
        className="focused-nav-menu__panel"
        role="region"
        aria-label="Menu"
        hidden={!menuOpen}
      >
        <div className="focused-nav-menu__brand">
          <span className="focused-brand-mark" aria-hidden="true" />
          <span>MUDD</span>
        </div>
        <PwaInstallAction className="focused-nav-menu__action" />
        <Button
          type="button"
          variant="quiet"
          className="focused-nav-menu__action"
          onClick={() => {
            setMenuOpen(false);
            void handleLeaveWorld();
          }}
          disabled={leaving}
        >
          <Users size={18} aria-hidden="true" /><span>Characters</span>
        </Button>
        <Button
          type="button"
          variant="quiet"
          className="focused-nav-menu__action"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
        >
          {theme === "light" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
          <span>{theme === "light" ? "Dark theme" : "Light theme"}</span>
        </Button>
      </div>
    </div>
  </nav>);
}
