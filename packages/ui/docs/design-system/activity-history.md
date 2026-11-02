# Session activity history

The world client retains the most recent **1,000 settled entries**. A single
unconfirmed travel preview is temporarily pinned outside that budget, so its
entries remain replaceable or removable. Confirmation reapplies the settled
budget; rejection removes only that preview. Re-entering a world or replacing
the character starts a separate history. There is no cross-session persistence.

ActivityHistoryWindow mounts at most **200 rows** by default. Its native
Older, Newer, and Latest buttons expose every retained entry without mounting
the entire retained history. Field notes uses the same session owner and
reverses the visible chronological window. It does not retain another copy.

The window anchors by entry ID. Incoming activity follows the latest window
only when the player is following latest. While reading older activity, the
app preserves the visible retained row and its scroll offset. If retention
evicts that row, the window moves to the oldest retained activity and explains
why. Latest resumes following new entries. The visible retention notice makes
the recent-session limit explicit.

Historical rows have aria-live="off". A separate stable session live region
announces “New activity received.” on an actual append. Navigating or replacing
historical rows does not replay old narration. The transcript remains a named,
keyboard-accessible region. The concise announcement deliberately avoids
reading an entire replay or long location description aloud on every update.

Stories cover long history, a 320px layout, light/dark themes, empty history,
and reverse notes. Component tests verify keyboard activation, mounted-row
bounds, retained anchors, eviction notices, and non-live historical rows.
App tests cover shared terminal/notes history, optimistic rollback, and stable
announcement DOM during navigation. Native browser, mobile viewport, and
screen-reader checks are separate verification items; automated tests do not
certify those checks.
