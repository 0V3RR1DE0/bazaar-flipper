# 🪙 Skyblock Bazaar Flip Finder

A zero-dependency web app that pulls **live** data from the Hypixel Skyblock Bazaar and ranks the
best flips by **estimated profit per hour** — themed to look like the in-game Bazaar GUI.

## Run it

It's a static site — no build, no server, no API key.

- **Easiest:** double-click `index.html`.
- **Recommended** (enables the watchlist alerts, service worker / offline, and avoids `file://`
  quirks):
  ```sh
  npx serve .
  # then open the printed http://localhost:... URL
  ```

## How the flip math works

Standard **order-flipping** model: place a **buy order** to acquire items, then a **sell offer** to
sell them — capturing the bazaar spread, minus tax. The Hypixel API field names are inverted, so:

| API field (`quick_status`) | Meaning                          | Used as            |
| -------------------------- | -------------------------------- | ------------------ |
| `sellPrice`                | Highest buy order (instant-sell) | **our buy cost**   |
| `buyPrice`                 | Lowest sell offer (instant-buy)  | **our sell price** |

```
marginPerUnit = sellOfferPrice * (1 - tax) - buyOrderPrice
flipsPerHour  = min(weeklyBuyVol, weeklySellVol) / 168 * yourVolumeShare
profitPerHour = marginPerUnit * flipsPerHour
```

Items are excluded if margin is non-positive, an order book is empty, or weekly volume is below
your threshold.

## Flip modes

Pick one with the **Flip type** selector:

- **Bazaar** — order-flip the spread within the bazaar (buy order → sell offer, minus tax).
- **NPC** — buy an item on the bazaar (via buy order) and sell it to an NPC for its fixed
  `npc_sell_price` (NPC sales are untaxed). Sourced from the Hypixel items resource.
- **Craft** — buy ingredients on the bazaar, craft up the **enchanted ladder** (160:1), and take the
  better exit (bazaar sell offer after tax, or NPC). Recipes live in `recipes.js` — a hand-curated,
  bazaar-validated table; any recipe whose IDs aren't on the bazaar is skipped automatically. Craft
  flips are mostly arbitraged away, so expect only a handful to be profitable at any moment, and
  treat extreme-margin rows as thin/manipulated (the Risk column flags them).

## Features

- **Profit/hr ranking** with tunable volume-share assumption (all three modes).
- **Risk flags** (`Safe` / `Caution` / `Risky`) — heuristics that catch manipulated or fragile
  markets: a single order dominating the book (whale), very few orders (thin book), or an
  unusually high spread. Hover the badge for the specific reasons.
- **Order-book depth** — units available within ~1% of the spread, i.e. how much you can flip
  before the price moves. (Reads `buy_summary` / `sell_summary`.)
- **Budget projection** — enter your coins; the `Profit (budget)` column shows total profit for one
  cycle, with units capped by both what you can afford and what the book supports.
- **Watchlist** — ★ items to pin them to the top; "Watchlist only" filter.
- **Click-to-copy** item name (paste straight into the in-game bazaar search).
- **Profit alerts** — set a profit/hr threshold; crossings trigger a beep + desktop notification.
- **CSV export** of the current table.
- **Bazaar Flipper perk tiers** — tax preset of 1.25% / 1.125% / 1.0% (or a custom value).
- **Session sparklines** — a live trend of each item's margin across refreshes (this session).
- **PWA** — installable, and the service worker caches the app shell + last bazaar response so it
  still opens with stale data when offline.
- **Minecraft font** — the Craftron Gaming "Minecraft Regular" face (the dafont one), self-hosted in
  `fonts/` so it loads reliably and works offline.
- All settings + watchlist persist in `localStorage`.

## Controls

`Search` · `Min weekly volume` · `Bazaar Flipper perk` / `Tax %` · `Your volume share %` ·
`Budget` · `Alert profit/hr` · `Show top N` · `Auto-refresh` (30s, pauses in hidden tabs) ·
`Watchlist only`. Click any column header to sort; click again to flip direction.

> **Note:** Profit/hr and budget figures are *estimates* scaled by your volume-share assumption and
> assume fills at the current top-of-book. Risk flags are heuristics — always sanity-check a flip
> in-game before committing coins.

Data: [Hypixel Bazaar API](https://api.hypixel.net/v2/skyblock/bazaar) (public, ~60s updates).
Not affiliated with Hypixel.
