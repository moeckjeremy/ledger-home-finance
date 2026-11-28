// Which website's logo to show for a merchant, bank or bill. Checked in order,
// so more specific names come first. Anything not listed keeps its category icon.
const DOMAINS: [RegExp, string][] = [
  // Payment apps and cards first: "Cash App Shelly" is Cash App, not Shell.
  [/venmo/, 'venmo.com'], [/paypal/, 'paypal.com'], [/cash ?app/, 'cash.app'], [/zelle/, 'zellepay.com'],
  [/disney premier/, 'chase.com'], [/prime store card|amazon store card|amz_storecrd/, 'amazon.com'],
  // Income and work
  [/vipkid|vipteacher/, 'vipteacher.com'],
  [/connections educ|connections academy|\barca\b/, 'connectionsacademy.com'],
  // Streaming and subscriptions
  [/netflix/, 'netflix.com'], [/spotify/, 'spotify.com'], [/\bhulu\b/, 'hulu.com'], [/disney/, 'disneyplus.com'],
  [/youtube/, 'youtube.com'], [/icloud/, 'icloud.com'], [/anthropic|claude/, 'anthropic.com'], [/openai/, 'openai.com'],
  [/runway/, 'runwayml.com'], [/oculus|meta quest/, 'meta.com'], [/roblox/, 'roblox.com'], [/\bsteam\b/, 'steampowered.com'],
  [/tailscale/, 'tailscale.com'], [/\bhuel\b/, 'huel.com'], [/gimkit/, 'gimkit.com'], [/blooket/, 'blooket.com'],
  [/scholastic/, 'scholastic.com'], [/teacherspayteach/, 'teacherspayteachers.com'], [/seatgeek/, 'seatgeek.com'],
  [/ticketmaster/, 'ticketmaster.com'], [/gofundme/, 'gofundme.com'], [/affirm/, 'affirm.com'],
  // Groceries and fuel
  [/kroger/, 'kroger.com'], [/walmart|wal-mart|wal mart|wm supercenter/, 'walmart.com'], [/sam'?s club/, 'samsclub.com'],
  [/costco/, 'costco.com'], [/trader joe/, 'traderjoes.com'], [/whole foods/, 'wholefoodsmarket.com'], [/\bharps\b/, 'harpsfood.com'],
  [/\baldi\b/, 'aldi.us'], [/buc-?ee/, 'buc-ees.com'], [/circle ?k/, 'circlek.com'], [/\bcasey'?s\b/, 'caseys.com'], [/murphy usa/, 'murphyusa.com'],
  [/\bshell\b/, 'shell.com'], [/exxon/, 'exxon.com'], [/chevron/, 'chevron.com'], [/\buber\b/, 'uber.com'], [/\blyft\b/, 'lyft.com'],
  // Eating out
  [/starbucks/, 'starbucks.com'], [/dunkin/, 'dunkindonuts.com'], [/mcdonald/, 'mcdonalds.com'], [/chick-?fil-?a/, 'chick-fil-a.com'],
  [/\bwendy'?s\b/, 'wendys.com'], [/whataburger/, 'whataburger.com'], [/\bsonic\b/, 'sonicdrivein.com'], [/taco bell/, 'tacobell.com'],
  [/chipotle/, 'chipotle.com'], [/papa john/, 'papajohns.com'], [/wingstop/, 'wingstop.com'], [/\bhardee'?s\b/, 'hardees.com'],
  [/dairy queen/, 'dairyqueen.com'], [/panda express/, 'pandaexpress.com'], [/olive garden/, 'olivegarden.com'],
  [/texas roadhouse/, 'texasroadhouse.com'], [/mcalister/, 'mcalistersdeli.com'], [/\barby'?s\b/, 'arbys.com'],
  [/tropical smoothie/, 'tropicalsmoothiecafe.com'], [/7 brew/, '7brew.com'], [/\bfreddy'?s\b/, 'freddys.com'], [/tacos 4 life/, 'tacos4life.com'],
  [/sweetgreen/, 'sweetgreen.com'], [/doordash/, 'doordash.com'], [/nothing bundt/, 'nothingbundtcakes.com'],
  // Shopping
  [/amazon|amzn|prime store|prime rewards/, 'amazon.com'], [/nike/, 'nike.com'], [/under ?armou?r|(?:^|[^a-z])ua(?:[^a-z]|$)/, 'underarmour.com'], [/\btarget\b/, 'target.com'], [/home depot/, 'homedepot.com'], [/lowe'?s/, 'lowes.com'],
  [/best buy/, 'bestbuy.com'], [/hobby ?lobby/, 'hobbylobby.com'], [/\bkohl'?s\b/, 'kohls.com'], [/tj maxx/, 'tjmaxx.com'], [/\bulta\b/, 'ulta.com'],
  [/maurices/, 'maurices.com'], [/five below/, 'fivebelow.com'], [/dollar general/, 'dollargeneral.com'],
  [/bath (&|and) body/, 'bathandbodyworks.com'], [/petsmart/, 'petsmart.com'], [/petco/, 'petco.com'], [/academy sports/, 'academy.com'],
  [/harbor freight/, 'harborfreight.com'], [/kirkland/, 'kirklands.com'], [/j ?crew/, 'jcrew.com'], [/rack room/, 'rackroomshoes.com'],
  [/\betsy\b/, 'etsy.com'], [/\bebay\b/, 'ebay.com'], [/aliexpress/, 'aliexpress.com'], [/uniqlo/, 'uniqlo.com'],
  // Bills, insurance, loans
  [/at&t|^att\b/, 'att.com'], [/verizon/, 'verizon.com'], [/t-mobile/, 't-mobile.com'], [/state farm/, 'statefarm.com'],
  [/first electric/, 'firstelectric.coop'], [/benton (util|municipal)/, 'bentonutilities.com'], [/summit util/, 'summitutilities.com'], [/entergy/, 'entergy.com'], [/terminix/, 'terminix.com'],
  [/aidvantage|advs ed serv/, 'aidvantage.com'], [/arkansas fed/, 'afcu.org'], // Google's icon service has nothing usable for toyota.com, so the UK site's (same badge) is used.
  [/toyota|rav4/, 'toyota.co.uk'], [/oculus|meta quest/, 'meta.com'],
  // Banks, cards and payment apps
  [/\bapple\b/, 'apple.com'], [/\bchase\b/, 'chase.com'], [/\bciti\b|citibank/, 'citi.com'], [/capital one/, 'capitalone.com'],
  [/american express|amex/, 'americanexpress.com'], [/synchrony/, 'synchrony.com'], [/first security/, 'fsbank.com'],
  [/fidelity/, 'fidelity.com'], [/\bally\b/, 'ally.com'], [/\bsquare\b|squareup/, 'squareup.com'],
];

// Logos supplied as image files in public/logos, for names the icon service
// doesn't know or gets wrong. These are tried before the website lookup.
const CUSTOM: [RegExp, string][] = [
  [/connections educ|connections academy|\barca\b/, 'connections-academy.png'],
  [/vipkid|vipteacher/, 'vipteacher.png'],
];

// Websites Claude has identified for merchants the lists above don't cover (server/logofinder.js), by lower-case name.
// `chosen` holds the ones you set yourself, which win over everything else.
// The number on every logo's address: "2", plus the server's own mark when the logo source has changed
// (a household added its Logo.dev key), so a browser asks for the pictures again.
let version = '';
export function setLogoVersion(v?: string) { version = v ? String(v).replace(/[^0-9a-z]/gi, '') : ''; similarCache.clear(); }
const V = () => (version ? `2-${version}` : '2');
let found: Record<string, string> = {};
let chosen: Record<string, string> = {};
export function setFoundLogos(maps: { found: Record<string, string>; chosen: Record<string, string> }) { found = maps.found || {}; chosen = maps.chosen || {}; similarCache.clear(); }

// Similar names share a logo (2026-11-18). A logo is set or found under one exact name ("Toyota Rav4
// payment"), but the same thing turns up elsewhere worded a little differently: the bill ("Toyota
// Rav4"), the account, the bank's version with a shop number ("WAL-MART #1234"), a longer form
// ("State Farm Insurance"). So when a name has no logo of its own, one belonging to a similar name is
// used. Two names are similar when, with shop numbers, punctuation and words such as "payment",
// "inc" or "the" taken out, they are the same, or one begins with the whole of the other and the
// shorter is at least two words, or is a single word of six letters or more that already has the
// logo (so "Amazon" lends its logo to "Amazon Prime Rewards Visa", but "Benton" can't borrow one
// from "Benton Utilities").
const FILLER = new Set(['payment', 'payments', 'pmt', 'bill', 'the', 'inc', 'llc', 'co', 'corp', 'company', 'store', 'online', 'purchase', 'pos', 'debit', 'card', 'ach', 'autopay', 'www', 'com']);
const plainWords = (name: string) => name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));
const similarCache = new Map<string, string | null>();
function similarIn(map: Record<string, string>, n: string): string | null {
  const mine = plainWords(n), joined = mine.join(' ');
  if (!joined) return null;
  let best: { domain: string; score: number } | null = null;
  for (const key in map) {
    // An account's own choice ("account 12") belongs to that account alone.
    if (!map[key] || key === n || /^account \d+$/.test(key)) continue;
    const theirs = plainWords(key), other = theirs.join(' ');
    if (!other) continue;
    const [short, long, words] = other.length <= joined.length ? [other, joined, theirs] : [joined, other, mine];
    const same = short === long;
    // A one-word name only lends its logo to longer names; it never borrows from one ("Benton", a town,
    // must not take Benton Utilities' logo).
    const starts = long.startsWith(`${short} `) && (words.length >= 2 || (short.length >= 6 && short === other));
    if (!same && !starts) continue;
    // The closest in length wins, so "Target" prefers "Target" over "Target Optical".
    const score = same ? 1000 : 100 - (long.length - short.length);
    if (!best || score > best.score) best = { domain: map[key], score };
  }
  return best?.domain ?? null;
}
/** A logo belonging to a similar name: one you set yourself first, then one that was found. */
function similar(n: string, mine: boolean): string | null {
  const id = `${mine ? 'c' : 'f'}|${n}`;
  if (!similarCache.has(id)) similarCache.set(id, similarIn(mine ? chosen : found, n));
  return similarCache.get(id) ?? null;
}

/** Image addresses to try for a name, best first. Empty when there's no logo. */
export function logoSources(name: string | null | undefined, key?: string, also: string[] = []): string[] {
  const n = (name || '').toLowerCase();
  const out: string[] = [];
  // An account's own choice is kept under a key that doesn't change when the account is renamed.
  if (key && chosen[key.toLowerCase()]) out.push(`/api/logo/${chosen[key.toLowerCase()]}?v=${V()}`);
  // Other names to try first (an account's own name, and what its payments are called), so an
  // account shows the logo already set or found for the transactions that go with it.
  for (const other of also) for (const src of logoSources(other)) if (!out.includes(src)) out.push(src);
  // (?v= changes when the logo source does, so browsers fetch the better pictures and don't keep old ones for a month.)
  const add = (src: string | null | undefined) => { if (src && !out.includes(src)) out.push(src); };
  if (chosen[n]) add(`/api/logo/${chosen[n]}?v=${V()}`);
  // One you set for a similar name comes next, ahead of the app's own guesses.
  else if (n) { const yours = similar(n, true); if (yours) add(`/api/logo/${yours}?v=${V()}`); }
  for (const [pattern, file] of CUSTOM) if (pattern.test(n)) add(`/logos/${file}`);
  const domain = logoDomain(n);
  if (domain) add(`/api/logo/${domain}?v=${V()}`);
  // Nothing of its own: borrow the logo found for a similar name.
  if (!out.length && n) { const theirs = similar(n, false); if (theirs) add(`/api/logo/${theirs}?v=${V()}`); }
  return out;
}

export function logoDomain(name: string | null | undefined): string | null {
  const n = (name || '').toLowerCase();
  if (!n) return null;
  for (const [pattern, domain] of DOMAINS) if (pattern.test(n)) return domain;
  return found[n] ?? null;
}
