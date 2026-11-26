// Scan ponctuel (lancé à la main) : node probe.mjs "<mots-clés séparés par |>"
import { searchMercari, searchYahoo, searchRakuma, KEYWORDS, isMatch, probablyBlack } from "./scan.mjs";
// "DAILY" = tous les mots-clés du bot, filtre du bot, sans les ventes passées
const DAILY = process.argv[2] === "DAILY";
const kws = DAILY ? KEYWORDS : (process.argv[2] || "9940-7010").split("|");
const keep = (t) => DAILY ? isMatch(t) : /9940|グランドクォーツ|グランドクオーツ|grand quartz/i.test(t);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const seen = new Set();
for (const kw of kws) {
  for (const [name, fn] of [["MERCARI", searchMercari], ["YAHOO", searchYahoo], ["RAKUMA", searchRakuma]]) {
    try {
      for (const it of await fn(kw)) {
        if (seen.has(it.key) || !keep(it.title)) continue;
        seen.add(it.key);
        console.log(`LIVE ${name}${DAILY && probablyBlack(it.title) ? " (noir?)" : ""} | ${it.title} | ¥${it.price} | ${it.bids ?? ""} | fin ${it.end ? it.end.toISOString() : "-"} | ${it.url} | ${it.image || ""}`);
      }
    } catch (e) { console.log(`ERR ${name} ${kw} ${e.message}`); }
  }
  // ventes Yahoo des 120 derniers jours
  if (!DAILY) try {
    const h = await (await fetch(`https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${encodeURIComponent(kw)}&n=100`, { headers: { "User-Agent": UA } })).text();
    const txt = h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, "\n").replace(/[ \t]+/g, " ");
    const lines = txt.split("\n").map((s) => s.trim()).filter(Boolean);
    lines.forEach((l, i) => { if (/9940/.test(l) && /落札/.test(lines.slice(i, i + 4).join(" ")) && !seen.has("c" + l)) { seen.add("c" + l); console.log(`SOLD | ${l.slice(0, 120)} | ${lines.slice(i + 1, i + 8).join(" ").slice(0, 120)}`); } });
  } catch (e) { console.log("ERR closed", e.message); }
}
