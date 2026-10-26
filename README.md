# DeadLitems
A UI for easy view of Deadlock items.

**Live site: [deadlockitems.netlify.app](https://deadlockitems.netlify.app/)**

A recreation of Deadlock's in-game item shop: items are split into **Weapon / Vitality / Spirit** tabs and grouped by tier with their soul cost. Click any item to see its full in-game tooltip plus the exact numbers behind it.

## Features
- In-game style shop: vertical category tabs, tier sections, item cards using the game's own card art
- Hover an item to highlight its whole upgrade chain (like the real shop)
- Click an item for details:
  - Tooltip recreation (innate / passive / active sections, cooldowns, descriptions)
  - Category, tier, cost, activation type, imbue info, internal IDs
  - **Built from** / **Builds into** — click to jump between items
  - Every stat with its exact value, internal key, scaling (e.g. `×0.5 Spirit Power`) and conditional flags, plus hidden properties not shown in the in-game tooltip
- Search across names, descriptions and stat labels
- Linkable views: `#spirit`, `#item/upgrade_xyz`
- Keyboard: `1` `2` `3` switch tabs, `/` search, `←` `→` step through items, `Esc` close

## Running
The easiest way is the live site: **https://deadlockitems.netlify.app/**

To run it locally there's no build step. Either open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Data is fetched live from the community [Deadlock API](https://deadlock-api.com) (`api.deadlock-api.com/v1/assets/items`), so it stays current with game patches.

## Files
- `index.html` — page shell
- `styles.css` — all styling
- `app.js` — data loading, shop rendering, item detail view
