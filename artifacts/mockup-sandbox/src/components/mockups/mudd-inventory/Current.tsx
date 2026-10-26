import './_group.css';

const items = [
  { id: 'old-rod', label: 'Old rod' },
  { id: 'copper-axe', label: 'Copper axe' },
  { id: 'pine-logs', label: 'Pine Logs', stackable: true, quantity: 5 },
  { id: 'spool', label: 'Spool of Thread', usesRemaining: 4 },
  { id: 'scale-vest', label: 'Bellwold scale vest', equipment: { slot: 'armor' as const } },
];

const infoTabs = [
  ['Vitals', '#/info'],
  ['Items', '#/info/items'],
  ['Equipment', '#/info/equipment'],
  ['Stats', '#/info/stats'],
  ['Field notes', '#/info/notes'],
  ['Codex', '#/info/codex'],
];

export function Current() {
  return (
    <main className="inventory-demo">
      <section className="focused-content" aria-label="Info screen">
        <div className="focused-screen" aria-label="Items">
          <nav className="focused-info-tabs" aria-label="Info sections">
            {infoTabs.map(([label, href]) => (
              <a key={label} href={href} className="focused-info-tab" aria-current={label === 'Items' ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <div className="focused-screen-heading">
            <div>
              <div className="focused-kicker">Character inventory</div>
              <h1 className="focused-screen-title">Items</h1>
            </div>
          </div>
          <section className="mudd-panel focused-card">
            <div className="focused-detail focused-detail--wide">
              <span>Carried items</span>
              {items.length ? (
                <div className="focused-inventory">
                  {items.map((item) => (
                    <div className="focused-inventory-entry" key={item.id}>
                      <button type="button" className="focused-inventory-item" aria-label={`Inspect ${item.label}`}>
                        {item.label}
                        {item.stackable && (item.quantity ?? 1) > 1 ? ` ×${item.quantity}` : ''}
                        {item.usesRemaining !== undefined ? ` · ${item.usesRemaining} uses` : ''}
                      </button>
                      {item.equipment && <span className="focused-item-tag">{item.equipment.slot}</span>}
                    </div>
                  ))}
                </div>
              ) : <strong>None</strong>}
            </div>
          </section>
        </div>
      </section>
      <nav className="focused-bottom-nav" aria-label="Main navigation">
        <button type="button" className="focused-tab">Play</button>
        <button type="button" className="focused-tab" aria-current="page">Info</button>
        <button type="button" className="focused-tab">Menu</button>
      </nav>
    </main>
  );
}
