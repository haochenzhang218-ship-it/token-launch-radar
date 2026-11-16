// Token launch radar, model "radar-2": one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols by an implied value that is the entry's own claim: what a
// token would be worth if the protocol's record stayed as it is. It never predicts whether or when
// a token is issued, and it never special-cases a protocol by name: the same function scores every
// row, from the snapshot's own figures only.
//
//   base      = tvl_usd x 0.20
//   momentum  = 1 + clamp(change_7d, -50, 150) / 100 x 0.8
//   seasoning = 0.55 + 0.45 x ln(1 + age_days) / ln(1 + 1460)   (age unknown: 0.75)
//   breadth   = 1 + 0.06 x min(chains - 1, 5)
//   category  = a small factor by what the protocol does (fee-earning kinds score higher)
//   implied   = max(1, round(base x momentum x seasoning x breadth x category))
//
// The board covers the snapshot's whole watchlist (the floor, never the ceiling) plus every other
// rankable pre-token protocol below the floor: the early rows the radar exists to find. Protocols
// whose token already trades are kept apart in a Live view that shows the market's own values,
// never mixed into the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  seasoning_floor: number;
  seasoning_range: number;
  seasoning_days: number;
  unknown_age_factor: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.2,
  growth_weight: 0.8,
  growth_floor: -50,
  growth_cap: 150,
  seasoning_floor: 0.55,
  seasoning_range: 0.45,
  seasoning_days: 1460,
  unknown_age_factor: 0.75,
  breadth_per_chain: 0.06,
  breadth_max_chains: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    momentum: number;
    seasoning: number;
    breadth: number;
    category_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  momentum: number;
  seasoning: number;
  breadth: number;
  category_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category factor: what a protocol does shapes how much of its TVL a future token could
 * capture. Fee-earning kinds (exchanges, lenders, yield vaults) score above 1; thin-margin
 * plumbing (bridges) scores below 1. Read from the category string alone, never a name.
 */
export function categoryFactor(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('lending') || c.includes('cdp') || c.includes('yield')) return 1.15;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('prediction')) return 1.1;
  if (c.includes('rwa') || c.includes('liquid staking') || c.includes('restak')) return 1.05;
  if (c.includes('bridge')) return 0.85;
  if (c.includes('insurance')) return 0.95;
  return 1;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; momentum: number; seasoning: number; breadth: number; catFactor: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const momentum = 1 + (growthPct / 100) * model.growth_weight;
  const seasoning =
    age === null
      ? model.unknown_age_factor
      : model.seasoning_floor +
        (Math.log(1 + age) / Math.log(1 + model.seasoning_days)) * model.seasoning_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_max_chains));
  const breadth = 1 + model.breadth_per_chain * extraChains;
  const catFactor = categoryFactor(protocol.category);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * momentum * seasoning * breadth * catFactor));
  return { implied, growthPct, momentum, seasoning, breadth, catFactor, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever its TVL.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol below the floor, by TVL order
  // of discovery (the ranking itself comes from the model, not from this order).
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      momentum: round4(s.momentum),
      seasoning: round4(s.seasoning),
      breadth: round4(s.breadth),
      category_factor: s.catFactor,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a chain, in the words a farmer budgets with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $4 to $8 of gas per transaction';
  if (c.includes('solana')) return 'about $0.05 of gas per transaction';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') || c.includes('zksync') || c.includes('linea') || c.includes('scroll') || c.includes('blast')) {
    return 'about $0.20 to $0.50 of gas per transaction';
  }
  if (c.includes('bnb') || c.includes('bsc')) return 'about $0.30 of gas per transaction';
  if (c.includes('avalanche')) return 'about $0.50 of gas per transaction';
  return 'about $1 of gas per transaction';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave the deposit earning.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s busiest pool on ${chain} and keep the LP position open.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and hold the receipt tokens.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} with ${name}, then put the bridged funds to work inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the native asset through ${name} and keep the staking receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as collateral on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take a position in one market on ${name}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names. Costs are chain-aware: the same action budgets differently on Ethereum than on a
 * low-fee chain.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const steps: string[] = [
    stepText(
      'Set up a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper kept offline.',
      'free to create; first transaction costs ' + gas,
      '5 minutes',
    ),
    stepText(actionFor(p, capital, chain), `$${capital} of capital plus ${gas}`, '15 minutes to set up'),
  ];
  if (secondChain !== null) {
    steps.push(
      stepText(
        `Repeat a smaller $${Math.max(25, Math.floor(capital / 4))} position on ${secondChain} so the same wallet shows up on two chains.`,
        `$${Math.max(25, Math.floor(capital / 4))} of capital plus ${gasFor(secondChain)}`,
        '10 minutes',
      ),
    );
  } else {
    steps.push(
      stepText(
        `Make one second action on ${chain} — a swap, a borrow or a vote — so the wallet is not a one-transaction farmer.`,
        gas,
        '10 minutes',
      ),
    );
  }
  steps.push(
    stepText(
      'Do one qualifying action every week — a deposit, a borrow, a swap or a vote — and keep the position above water the whole time.',
      `about ${gas} a week`,
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days so the activity lands in more than one snapshot.`,
      `the $${capital} stays locked in the position`,
      `${hold} days`,
    ),
    stepText(
      `Before you withdraw, open the protocol's own points or rewards page from the link it publishes, and claim only there. Never pay a fee to claim, and never connect your wallet from a link in a chat or a social post.`,
      'no fee to check',
      '10 minutes',
    ),
    stepText(
      'Write the wallet, the dates and every transaction hash in a farm log, and plan the exit: unwind in two steps and leave a small position until any distribution is confirmed.',
      'nothing but the log',
      '5 minutes',
    ),
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's dashboard form, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    momentum: row.model.momentum,
    seasoning: row.model.seasoning,
    breadth: row.model.breadth,
    category_factor: row.model.category_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist.slice(),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
