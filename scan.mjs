// Bot d'alerte Seiko Sardonyx — Mercari Japon, Yahoo! Auctions (incl. Yahoo!フリマ), Rakuma, r/Watchexchange
// Envoie une notification push (ntfy) dès qu'une nouvelle annonce correspond.
// Aucune dépendance : Node 20+ (fetch + WebCrypto natifs).
import { readFile, writeFile } from "node:fs/promises";

// ---------- Réglages ----------
const KEYWORDS = [
  // calibres et références catalogue
  "6020-5260", "6020-5280", "7820-5000",
  "CGT031", "CGT073", "AGT023", "CHG803",
  // descriptions de cadran, y compris fautes fréquentes
  "セイコー サードニクス", "シャリオ サードニクス", "サードオニキス セイコー",
  "セイコー 瑪瑙 文字盤", "セイコー メノウ 文字盤", "セイコー 木目 文字盤",
  "シャリオ 木目", "シャリオ ブラウン", "チャリオ セイコー", "ドルチェ 6020",
];
// Un titre est retenu s'il contient un calibre / une référence…
const STRONG = /6020[\s\-ー‐－―]*52[68]0|7820[\s\-ー‐－―]*5000|CHG\s?803|CGT\s?0?31|CGT\s?073|AGT\s?023/i;
// …ou un mot "pierre" ET un mot "Seiko"
const STONE = /サードニクス|サードニックス|サードオニキス|sardonyx|瑪瑙|メノウ|めのう|agate|木目|タイガーアイ|石文字盤|天然石|ストーン文字盤|ストーンダイヤル|stone dial|wood ?grain|tiger ?eye/i;
const SEIKO = /seiko|セイコー|せいこー|シャリオ|チャリオ|chariot|ドルチェ|dolce/i;
// Exclus : autres gammes, objets, cadrans explicitement noirs
const EXCLUDE = /クレドール|credor|置時計|置き時計|壁掛け|掛け時計|掛時計|柱時計|目覚まし|クロック|clock|ネックレス|ペンダント|指輪|リング|ブローチ|ルース|原石|ブラックオニキス|黒文字盤|ブラック文字盤|ブラックダイヤル|black dial|三菱|グランディス|ブレーキ|ワイパー|ヘッドライト|ルームランプ|シフトノブ|ステアリング|ハンドル|N84W|N94W/i;

const NTFY_TOPIC = process.env.NTFY_TOPIC;           // obligatoire (secret GitHub)
const NTFY_SERVER = process.env.NTFY_SERVER || "https://ntfy.sh";
const FX = Number(process.env.JPY_PER_USD || 156);
const MAX_AGE_H = 72;                                // ignore les annonces plus vieilles
const STATE_FILE = "seen.json";
const DRY = process.env.DRY_RUN === "1";
// Appel vocal Telegram via CallMeBot (gratuit) — actif seulement si le secret CALLMEBOT_USER existe
const CALL_USER = process.env.CALLMEBOT_USER;          // ex. @tonpseudo
const CALL_FOR = process.env.CALL_FOR || "buynow";     // "buynow" (achats immédiats) ou "all"

// ---------- Utilitaires ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const yen = (n) => "¥" + Number(n).toLocaleString("en-US");
const usd = (n) => "≈$" + Math.round(Number(n) / FX).toLocaleString("en-US");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export function isMatch(title) {
  if (!title || EXCLUDE.test(title)) return false;
  if (STRONG.test(title)) return true;
  return STONE.test(title) && SEIKO.test(title);
}

function pacific(date) {
  return date.toLocaleString("fr-FR", { timeZone: "America/Los_Angeles", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ---------- Mercari ----------
let mercariKey;
async function dpop(url, method) {
  if (!mercariKey) mercariKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", mercariKey.publicKey);
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: { crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y } };
  const payload = { iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(), htu: url, htm: method, uuid: crypto.randomUUID() };
  const input = b64u(JSON.stringify(header)) + "." + b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, mercariKey.privateKey, new TextEncoder().encode(input));
  return input + "." + b64u(sig);
}

export async function searchMercari(keyword, fetchFn = fetch) {
  const url = "https://api.mercari.jp/v2/entities:search";
  const body = {
    userId: "", pageSize: 60, pageToken: "", searchSessionId: crypto.randomUUID().replace(/-/g, ""),
    indexRouting: "INDEX_ROUTING_UNSPECIFIED", thumbnailTypes: [],
    searchCondition: {
      keyword, excludeKeyword: "", sort: "SORT_CREATED_TIME", order: "ORDER_DESC", status: ["STATUS_ON_SALE"],
      sizeId: [], categoryId: [], brandId: [], sellerId: [], priceMin: 0, priceMax: 0, itemConditionId: [],
      shippingPayerId: [], shippingFromArea: [], shippingMethod: [], colorId: [], hasCoupon: false,
      attributes: [], itemTypes: [], skuIds: [],
    },
    defaultDatasets: ["DATASET_TYPE_MERCARI", "DATASET_TYPE_BEYOND"], serviceFrom: "suruga",
    withItemBrand: true, withItemSize: false, withItemPromotions: true, withItemSizes: true, withShopname: false,
  };
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Platform": "web", "User-Agent": UA, DPoP: await dpop(url, "POST") },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mercari HTTP ${res.status}`);
  const json = await res.json();
  return (json.items || []).map((i) => {
    const shop = i.itemType === "ITEM_TYPE_BEYOND";
    return {
      key: "mercari:" + i.id,
      source: shop ? "Mercari Shops" : "Mercari",
      title: i.name,
      price: Number(i.price),
      created: Number(i.created) * 1000,
      image: i.thumbnails?.[0] || null,
      url: shop ? `https://jp.mercari.com/shops/product/${i.id}` : `https://jp.mercari.com/item/${i.id}`,
      buyee: shop ? null : `https://buyee.jp/mercari/item/${i.id}`,
      buyNow: true,
    };
  });
}

// ---------- Yahoo! Auctions (+ Yahoo!フリマ) ----------
export function parseYahoo(html) {
  const s = html.replace(/\\"/g, '"').replace(/\\u0026/g, "&");
  const out = new Map();
  for (const part of s.split('{"auctionId":"').slice(1)) {
    const id = part.slice(0, part.indexOf('"'));
    if (!id || out.has(id)) continue;
    const get = (k) => {
      const m = part.match(new RegExp('"' + k + '":("(?:[^"\\\\]|\\\\.)*"|[^,}\\]]+)'));
      return m ? m[1].replace(/^"|"$/g, "") : null;
    };
    const title = get("title");
    if (!title) continue;
    const flea = get("isFleamarketItem") === "true";
    const bin = get("buyNowPrice");
    const start = get("startTime");
    const stm = part.match(/stm=(\d+)/);
    out.set(id, {
      key: "yahoo:" + id,
      source: flea ? "Yahoo!フリマ" : "Yahoo! Auctions",
      title,
      price: Number(get("price")),
      buyNowPrice: bin && bin !== "null" ? Number(bin) : null,
      bids: Number(get("bidCount") || 0),
      end: get("endTime") ? new Date(get("endTime")) : null,
      created: start ? Date.parse(start) : stm ? Number(stm[1]) * 1000 : Date.now(),
      image: get("imageUrl"),
      url: flea ? `https://paypayfleamarket.yahoo.co.jp/item/${id}` : `https://auctions.yahoo.co.jp/jp/auction/${id}`,
      buyee: flea ? null : `https://buyee.jp/item/yahoo/auction/${id}`,
      buyNow: flea,
    });
  }
  return [...out.values()];
}

export async function searchYahoo(keyword, fetchFn = fetch) {
  const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(keyword)}&n=50&s1=new&o1=d`;
  const res = await fetchFn(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" } });
  if (res.status === 404) return []; // Yahoo répond 404 quand la recherche n'a aucun résultat
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  return parseYahoo(await res.text());
}

// ---------- Rakuma (fril.jp) ----------
const unescapeHtml = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export function parseRakuma(html) {
  const out = new Map();
  const re = /<a href="https:\/\/item\.fril\.jp\/([0-9a-f]+)" class="link_search_image"([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const [, id, body] = m;
    if (out.has(id)) continue;
    const name = body.match(/data-rat-item_name="([^"]*)"/);
    const price = body.match(/data-rat-price="(\d+)"/);
    const img = body.match(/data-original="([^"]+)"/);
    if (!name) continue;
    out.set(id, {
      key: "rakuma:" + id, source: "Rakuma", title: unescapeHtml(name[1]),
      price: price ? Number(price[1]) : null, created: Date.now(),
      image: img ? img[1] : null, url: `https://item.fril.jp/${id}`,
      buyee: null, buyNow: true,
    });
  }
  return [...out.values()];
}

export async function searchRakuma(keyword, fetchFn = fetch) {
  const url = `https://fril.jp/s?query=${encodeURIComponent(keyword)}&order=desc&sort=created_at&transaction=selling`;
  const res = await fetchFn(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Rakuma HTTP ${res.status}`);
  return parseRakuma(await res.text());
}

// ---------- Reddit r/Watchexchange (dernières annonces, tous mots confondus) ----------
const REDDIT_UA = "sardonyx-bot/1.0 (personal watch alert; github.com/COlivier95/sardonyx-bot)";
function redditItem(p) {
  return {
    key: "reddit:" + p.id, source: "r/Watchexchange", title: p.title, price: null, priceText: (p.title.match(/\$\s?[\d,]+/) || [""])[0],
    created: p.created * 1000, image: null, url: p.url, buyee: null, buyNow: true,
  };
}
export function parseRedditRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<id>t3_(\w+)<\/id>/) || [])[1];
    const title = unescapeHtml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const link = (e.match(/<link href="([^"]+)"/) || [])[1];
    const upd = (e.match(/<(?:published|updated)>([^<]+)</) || [])[1];
    if (id && title) out.push(redditItem({ id, title, url: link, created: Date.parse(upd || Date.now()) / 1000 }));
  }
  return out;
}
export async function searchReddit(_kw, fetchFn = fetch) {
  const headers = { "User-Agent": REDDIT_UA };
  let res = await fetchFn("https://www.reddit.com/r/Watchexchange/new.json?limit=100&raw_json=1", { headers });
  if (res.ok) {
    const j = await res.json();
    return (j.data?.children || []).map((c) => redditItem({ id: c.data.id, title: c.data.title, url: "https://www.reddit.com" + c.data.permalink, created: c.data.created_utc }))
      .filter((it) => !/\[\s*WTB\s*\]/i.test(it.title));
  }
  res = await fetchFn("https://www.reddit.com/r/Watchexchange/new/.rss?limit=100", { headers });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
  return parseRedditRss(await res.text()).filter((it) => !/\[\s*WTB\s*\]/i.test(it.title));
}

// ---------- Notifications (ntfy) ----------
export function buildNotification(it) {
  const lines = [it.title];
  if (it.price == null) lines.push(it.priceText ? `Prix annoncé : ${it.priceText}` : "Prix : voir l'annonce");
  else if (it.buyNow) lines.push(`Achat immédiat : ${yen(it.price)} (${usd(it.price)})`);
  else {
    lines.push(`Enchère : ${yen(it.price)} (${usd(it.price)}) · ${it.bids} enchère(s)`);
    if (it.buyNowPrice) lines.push(`Achat immédiat possible : ${yen(it.buyNowPrice)} (${usd(it.buyNowPrice)})`);
    if (it.end) lines.push(`Fin : ${pacific(it.end)} (heure de Californie)`);
  }
  const actions = [{ action: "view", label: "Voir sur " + it.source.replace(/!.*/, "").replace(" Shops", ""), url: it.url, clear: false }];
  if (it.buyee) actions.push({ action: "view", label: "Ouvrir dans Buyee", url: it.buyee, clear: false });
  return {
    topic: NTFY_TOPIC,
    title: `${it.buyNow ? "⚡" : "🔨"} ${it.source}${it.price != null ? " · " + yen(it.price) : it.priceText ? " · " + it.priceText : ""}`,
    message: lines.join("\n"),
    click: it.url,
    attach: it.image || undefined,
    priority: it.buyNow ? 5 : 4,
    tags: ["watch"],
    actions,
  };
}

export function callText(items) {
  const model = (t) => { const m = t.match(/6020[\s\-ー‐－―]*52[68]0|7820[\s\-ー‐－―]*5000/); return m ? m[0].replace(/[^0-9]+/g, " ") : "cadran en pierre"; };
  const it = items[0];
  const prix = it.price != null ? `${Number(it.price).toLocaleString("fr-FR")} yens` : (it.priceText || "prix sur l'annonce");
  let t = `Alerte Seiko sardonyx. Nouvelle annonce ${it.source.replace("r/", "reddit ")}, ${model(it.title)}, ${prix}.`;
  if (items.length > 1) t += ` Et ${items.length - 1} autre${items.length > 2 ? "s" : ""}.`;
  return (t + " Regarde tes notifications n t f y.").slice(0, 250);
}

async function call(items, fetchFn = fetch) {
  const text = callText(items);
  if (DRY) { console.log("[DRY] appel:", text); return; }
  const url = `https://api.callmebot.com/start.php?user=${encodeURIComponent(CALL_USER)}&text=${encodeURIComponent(text)}&lang=fr-FR-Standard-A&rpt=2&cc=missed`;
  // le service gratuit est parfois saturé ("FLOOD") : on réessaie jusqu’à 6 fois sur ~6 min
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetchFn(url);
      const body = (await res.text()).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const busy = /FLOOD|skipped|busy|queue is full|try again|ERROR/i.test(body);
      console.log(`callmebot essai ${attempt}: HTTP ${res.status} ${busy ? "SATURÉ" : "OK"} | ${body.slice(-220)}`);
      if (res.ok && !busy) return true;
    } catch (e) { console.error("callmebot", e.message); }
    if (attempt < 6) await sleep(fetchFn === fetch ? 70000 : 0);
  }
  return false;
}

async function send(payload, fetchFn = fetch) {
  if (DRY) { console.log("[DRY] notification:", JSON.stringify(payload)); return; }
  const res = await fetchFn(NTFY_SERVER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) console.error("ntfy HTTP", res.status, await res.text());
}

// ---------- Boucle principale ----------
export async function run({ fetchFn = fetch, state } = {}) {
  if (!NTFY_TOPIC && !DRY) throw new Error("NTFY_TOPIC manquant");
  state = state || JSON.parse(await readFile(STATE_FILE, "utf8").catch(() => "{}"));
  state.seen ||= {};
  const SOURCES = { mercari: searchMercari, yahoo: searchYahoo, rakuma: searchRakuma };
  state.fails = { mercari: 0, yahoo: 0, rakuma: 0, reddit: 0, ...(state.fails || {}) };
  const firstRun = Object.keys(state.seen).length === 0;
  // chaque site est d'abord mémorisé en silence (évite une rafale d'alertes à l'ajout d'un site)
  state.seeded ||= firstRun ? {} : { mercari: true, yahoo: true };
  const now = Date.now();
  const found = new Map();
  const ok = { mercari: 0, yahoo: 0, rakuma: 0, reddit: 0 };

  try {
    for (const it of await searchReddit(null, fetchFn)) if (isMatch(it.title)) found.set(it.key, it);
    ok.reddit = 1;
  } catch (e) { console.error("reddit", e.message); }

  for (const kw of KEYWORDS) {
    for (const [src, fn] of Object.entries(SOURCES)) {
      try {
        for (const it of await fn(kw, fetchFn)) if (isMatch(it.title)) found.set(it.key, it);
        ok[src]++;
      } catch (e) {
        console.error(src, kw, e.message);
      }
      await sleep(DRY || fetchFn !== fetch ? 0 : 700);
    }
  }

  // santé des sources : alerte après 6 échecs complets d'affilée (~30 min), puis au retour
  for (const src of Object.keys(ok)) {
    if (ok[src] === 0) {
      state.fails[src]++;
      if (state.fails[src] === 6) await send({ topic: NTFY_TOPIC, title: `⚠️ Bot sardonyx : ${src} ne répond plus`, message: "Le bot continue d'essayer. Il te préviendra quand ça repart.", priority: 3, tags: ["warning"] }, fetchFn);
    } else {
      if (state.fails[src] >= 6) await send({ topic: NTFY_TOPIC, title: `✅ Bot sardonyx : ${src} répond de nouveau`, message: "Surveillance rétablie.", priority: 2 }, fetchFn);
      state.fails[src] = 0;
    }
  }

  let sent = 0;
  const toCall = [];
  for (const it of found.values()) {
    if (state.seen[it.key]) continue;
    state.seen[it.key] = now;
    if (firstRun || !state.seeded[it.key.split(":")[0]]) continue;
    if (now - it.created > MAX_AGE_H * 3600e3) continue;
    await send(buildNotification(it), fetchFn);
    sent++;
    if (CALL_FOR === "all" || it.buyNow) toCall.push(it);
  }
  // un seul appel par passage, même s'il y a plusieurs annonces
  if (CALL_USER && toCall.length) await call(toCall, fetchFn);
  if (CALL_USER && process.env.TEST_CALL === "1") await call([{ source: "test", title: "6020-5280", price: 98000 }], fetchFn);

  if (firstRun) {
    await send({ topic: NTFY_TOPIC, title: "✅ Bot sardonyx actif", message: `${found.size} annonce(s) déjà en ligne mémorisées. Tu recevras désormais une alerte pour chaque nouvelle annonce.\nMercari : ${ok.mercari}/${KEYWORDS.length} · Yahoo : ${ok.yahoo}/${KEYWORDS.length} · Rakuma : ${ok.rakuma}/${KEYWORDS.length} · Reddit : ${ok.reddit ? "OK" : "échec"}`, priority: 3, tags: ["watch"] }, fetchFn);
  }

  for (const src of Object.keys(ok)) if (ok[src] > 0) state.seeded[src] = true;
  // garde les 5000 annonces les plus récentes en mémoire
  const entries = Object.entries(state.seen).sort((a, b) => b[1] - a[1]).slice(0, 5000);
  state.seen = Object.fromEntries(entries);
  console.log(`matches=${found.size} new_sent=${sent} ok=${JSON.stringify(ok)} first=${firstRun}`);
  return state;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = await run();
  if (!DRY) await writeFile(STATE_FILE, JSON.stringify(state, null, 0) + "\n");
}
