/**
 * HotHub 数据抓取脚本
 * 来源：
 *  - tophub.today 榜单节点页（中文平台官方热榜，含热度值）
 *  - Bilibili 官方排行榜 API（含播放/点赞/评论等维度数据）
 *  - Reddit / Hacker News 官方 JSON API
 *  - GitHub Trending 页面
 *  - RSSHub 公共实例（NGA 热帖）
 * 输出：data/hotboards.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "hotboards.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIMEOUT_MS = 25000;
const RETRIES = 2;

async function get(url, headers = {}) {
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/json,application/xml,*/*", ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---------- 通用工具 ---------- */

function decodeHtml(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** "115万" -> 1150000 ; "4,658" -> 4658 ; "50亮" -> 50 ; "1.2k" -> 1200 */
function parseHeat(s) {
  if (!s) return null;
  s = String(s).trim().replace(/,/g, "");
  const m = s.match(/^([\d.]+)\s*([万亿wWkK]?)/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const unit = m[2].toLowerCase();
  if (unit === "万" || unit === "w") n *= 1e4;
  else if (unit === "亿") n *= 1e8;
  else if (unit === "k") n *= 1e3;
  return Math.round(n);
}

function fmtHeat(n) {
  if (n == null || Number.isNaN(n)) return null;
  if (n >= 1e8) return (n / 1e8).toFixed(1) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

/* ---------- tophub 解析 ---------- */

const TOPHUB_ROW_RE = /<tr>([\s\S]*?)<\/tr>/g;
const RANK_RE = /<td align="center">\s*(\d+)\.?/;
const HEAT_WS_RE = /<td class="ws">([\s\S]*?)<\/td>/;
const HEAT_DESC_RE = /<div class="item-desc">([\s\S]*?)<\/div>/;
const HEAT_EXTRA_RE = /<div class="item-extra">([\s\S]*?)<\/div>/;
const LINK_RE = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

async function fetchTophub(nodeId, limit = 30) {
  let items = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const html = await get(`https://tophub.today/n/${nodeId}`);
    items = parseTophubRows(html, limit);
    if (items.length) return items;
    await new Promise((r) => setTimeout(r, 2000)); // 空页可能是被限流，稍等重试
  }
  return items;
}

function parseTophubRows(html, limit = 30) {
  const items = [];
  let rm;
  while ((rm = TOPHUB_ROW_RE.exec(html)) !== null) {
    const row = rm[1];
    const rankM = row.match(RANK_RE);
    if (!rankM) continue;

    // 标题链接：取正文最长的链接（详情链接/图标链接的文本为空或为图标）
    let best = null;
    let lm;
    LINK_RE.lastIndex = 0;
    while ((lm = LINK_RE.exec(row)) !== null) {
      const text = decodeHtml(lm[2]);
      if (text.length > 2 && (!best || text.length > best.text.length)) best = { url: lm[1], text };
    }
    if (!best) continue;

    // 热度优先级：item-extra > ws > item-desc（item-desc 可能是作者名）
    const heatM = row.match(HEAT_EXTRA_RE) || row.match(HEAT_WS_RE) || row.match(HEAT_DESC_RE);
    const heat = heatM ? decodeHtml(heatM[1]) : "";
    items.push({
      rank: parseInt(rankM[1], 10),
      title: best.text,
      url: best.url,
      heat: heat || null,
      heatNum: parseHeat(heat),
    });
    if (items.length >= limit) break;
  }
  return items;
}

/* ---------- Bilibili 排行榜（含维度统计） ---------- */

async function fetchBilibiliRank(limit = 30) {
  let data;
  for (const api of [
    "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0",
    "https://api.bilibili.com/x/web-interface/ranking?rid=0&day=3",
  ]) {
    try {
      const text = await get(api, { Referer: "https://www.bilibili.com/" });
      const json = JSON.parse(text);
      if (json.code === 0) {
        const list = json.data?.list || json.data || [];
        data = list;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!data) throw new Error("bilibili ranking api failed");
  return data.slice(0, limit).map((v, i) => {
    const st = v.stat || {};
    return {
      rank: i + 1,
      title: decodeHtml(v.title || ""),
      url: v.short_link_v2 || `https://www.bilibili.com/video/${v.bvid}`,
      heat: fmtHeat(st.view) + "播放",
      heatNum: st.view ?? null,
      stats: {
        view: st.view ?? null,
        like: st.like ?? null,
        coin: st.coin ?? null,
        fav: st.favorite ?? null,
        share: st.share ?? null,
        reply: st.reply ?? null,
      },
    };
  });
}

/* ---------- Reddit ---------- */

const REDDIT_SORTS = { hot: "hot", top: "top", controversial: "controversial" };

async function fetchReddit(sort) {
  const url = `https://www.reddit.com/r/all/${sort}.json?limit=30&t=day`;
  const text = await get(url, { Accept: "application/json" });
  const json = JSON.parse(text);
  const kids = json.data?.children || [];
  return kids.map((k, i) => {
    const d = k.data || {};
    return {
      rank: i + 1,
      title: decodeHtml(d.title || ""),
      url: `https://www.reddit.com${d.permalink || ""}`,
      heat: `${fmtHeat(d.score)}分 · ${fmtHeat(d.num_comments)}评论`,
      heatNum: d.score ?? null,
      sub: d.subreddit,
    };
  });
}

/* ---------- Hacker News ---------- */

async function fetchHN(type) {
  const listUrl = `https://hacker-news.firebaseio.com/v0/${type}stories.json`;
  const ids = JSON.parse(await get(listUrl)).slice(0, 30);
  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        return JSON.parse(await get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`));
      } catch {
        return null;
      }
    })
  );
  const out = [];
  for (const s of items) {
    if (!s) continue;
    out.push({
      rank: out.length + 1,
      title: decodeHtml(s.title || ""),
      url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      heat: `${s.score ?? 0}分 · ${s.descendants ?? 0}评论`,
      heatNum: s.score ?? null,
      author: s.by,
    });
  }
  return out;
}

/* ---------- GitHub Trending ---------- */

async function fetchGithubTrending(since) {
  const html = await get(`https://github.com/trending?since=${since}`);
  const blocks = html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) || [];
  const out = [];
  for (const b of blocks.slice(0, 30)) {
    const repoM = b.match(/href="\/([^"]+)"[\s\S]*?<h2/);
    const titleM = b.match(/<h2[^>]*>[\s\S]*?<\/a>\s*<\/h2>/);
    const descM = b.match(/<p class="col-9[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/);
    const langM = b.match(/<span itemprop="programmingLanguage">([^<]+)<\/span>/);
    const starM = b.match(/([\d,.]+)\s+stars\s+today/i);
    const repo = repoM ? decodeHtml(repoM[1]) : "";
    let title = "";
    if (titleM) {
      const a = titleM[0].match(/<a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      if (a) title = decodeHtml(a[1]);
    }
    const stars = starM ? parseInt(starM[1].replace(/,/g, ""), 10) : null;
    out.push({
      rank: out.length + 1,
      title: title || repo,
      url: `https://github.com/${repo}`,
      heat: stars != null ? `+${stars} stars today` : null,
      heatNum: stars,
      desc: descM ? decodeHtml(descM[1]) : null,
      lang: langM ? decodeHtml(langM[1]) : null,
    });
  }
  return out;
}

/* ---------- RSSHub（NGA） ---------- */

async function fetchNga() {
  const xml = await get("https://rsshub.app/nga/thread?fid=-7");
  const items = [...xml.matchAll(/<item>\s*<title>(.*?)<\/title>\s*<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>/g)];
  const out = [];
  for (const m of items.slice(0, 30)) {
    out.push({
      rank: out.length + 1,
      title: decodeHtml(m[1]),
      url: m[2].replace(/&amp;/g, "&"),
      heat: decodeHtml(m[3] || "").slice(0, 16),
      heatNum: null,
    });
  }
  if (!out.length) throw new Error("nga rss empty");
  return out;
}

/* ---------- RSS（通用，用于国际财经源） ---------- */

async function fetchRss(url, limit = 30) {
  const xml = await get(url);
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const it = m[1];
    const titleM = it.match(/<title>(.*?)<\/title>/s);
    const linkM = it.match(/<link>(.*?)<\/link>/s);
    if (!titleM || !linkM) continue;
    items.push({
      rank: items.length + 1,
      title: decodeHtml(titleM[1]),
      url: decodeHtml(linkM[1]),
      heat: null,
      heatNum: null,
    });
    if (items.length >= limit) break;
  }
  if (!items.length) throw new Error("rss 无条目");
  return items;
}

/* ---------- 榜单配置 ---------- */

const BOARDS = [
  {
    id: "weibo",
    name: "微博",
    group: "综合热点",
    tabs: [
      { id: "hot", label: "热搜榜", source: "tophub", node: "KqndgxeLl9" },
      { id: "topic", label: "话题榜", source: "tophub", node: "VaobJ98oAj" },
      { id: "society", label: "社会榜", source: "tophub", node: "Om4ejl3vxE" },
      { id: "ent", label: "文娱榜", source: "tophub", node: "3QeLwJEd7k" },
    ],
  },
  { id: "baidu", name: "百度", group: "综合热点", tabs: [{ id: "hot", label: "实时热点", source: "tophub", node: "Jb0vmloB1G" }] },
  { id: "toutiao", name: "今日头条", group: "综合热点", tabs: [{ id: "hot", label: "头条热榜", source: "tophub", node: "x9ozB4KoXb" }] },
  { id: "tencent-news", name: "腾讯新闻", group: "综合热点", tabs: [{ id: "hot", label: "热点榜", source: "tophub", node: "12owgX0oNV" }] },
  { id: "wechat", name: "微信", group: "综合热点", tabs: [{ id: "hot", label: "24h热文榜", source: "tophub", node: "WnBe01o371" }] },
  { id: "zhihu", name: "知乎", group: "问答社区", tabs: [{ id: "hot", label: "热榜", source: "tophub", node: "mproPpoq6O" }] },
  { id: "v2ex", name: "V2EX", group: "问答社区", tabs: [{ id: "hot", label: "热门主题", source: "tophub", node: "KGoRAN1el6" }] },
  { id: "tieba", name: "百度贴吧", group: "问答社区", tabs: [{ id: "hot", label: "热议榜", source: "tophub", node: "Om4ejxvxEN" }] },
  { id: "douban", name: "豆瓣", group: "问答社区", tabs: [{ id: "hot", label: "新片榜", source: "tophub", node: "mDOvnyBoEB" }] },
  { id: "hupu", name: "虎扑", group: "问答社区", tabs: [{ id: "hot", label: "步行街热帖", source: "tophub", node: "G47o8weMmN" }] },
  { id: "nga", name: "NGA", group: "问答社区", tabs: [{ id: "hot", label: "热帖", source: "rsshub-nga" }] },
  {
    id: "douyin",
    name: "抖音",
    group: "视频娱乐",
    tabs: [
      { id: "hot", label: "热点榜", source: "tophub", node: "K7GdaMgdQy" },
      { id: "total", label: "总榜", source: "tophub", node: "DpQvNABoNE" },
      { id: "video", label: "视频总榜", source: "tophub", node: "yjvQ9wDvbg" },
      { id: "ent", label: "娱乐榜", source: "tophub", node: "2me33NBewj" },
      { id: "food", label: "美食榜", source: "tophub", node: "aEdZWyBerO" },
      { id: "sports", label: "体育榜", source: "tophub", node: "3adqqzadng" },
      { id: "finance", label: "财经榜", source: "tophub", node: "2me3N3xdwj" },
      { id: "tech", label: "科技榜", source: "tophub", node: "MZd7N2OvrO" },
      { id: "travel", label: "旅行榜", source: "tophub", node: "2KeDMgAoNP" },
      { id: "car", label: "汽车榜", source: "tophub", node: "KGoRwZbvl6" },
      { id: "drama", label: "剧情榜", source: "tophub", node: "aEdZyWXvrO" },
      { id: "game", label: "游戏榜", source: "tophub", node: "YKd6MGqvaP" },
      { id: "pictext", label: "图文控榜", source: "tophub", node: "2KeDgMQdNP" },
      { id: "edu", label: "文化教育榜", source: "tophub", node: "JndkmwLo3V" },
      { id: "fashion", label: "时尚榜", source: "tophub", node: "VaobyZGeAj" },
      { id: "parenting", label: "亲子榜", source: "tophub", node: "wkvljZqez1" },
      { id: "nature", label: "动植物榜", source: "tophub", node: "Dgey135eZq" },
      { id: "campus", label: "校园榜", source: "tophub", node: "4qv9N21daK" },
      { id: "acg", label: "二次元榜", source: "tophub", node: "Ywv4NVxePa" },
      { id: "star", label: "明星榜", source: "tophub", node: "RrvWy7Re5z" },
      { id: "talent", label: "才艺榜", source: "tophub", node: "BwdGrXjvPx" },
      { id: "rural", label: "三农榜", source: "tophub", node: "6YoVyWDeZa" },
      { id: "outdoor", label: "户外榜", source: "tophub", node: "47o8k3jeMm" },
      { id: "charity", label: "公益榜", source: "tophub", node: "5PdMX1Zvmg" },
      { id: "creative", label: "创意榜", source: "tophub", node: "DOvnMl1oEB" },
      { id: "vlog", label: "随拍榜", source: "tophub", node: "3adqzqZeng" },
      { id: "life", label: "泛生活榜", source: "tophub", node: "Dgey31RvZq" },
    ],
  },
  {
    id: "bilibili",
    name: "B站",
    group: "视频娱乐",
    tabs: [
      { id: "day", label: "全站日榜", source: "tophub", node: "74KvxwokxM" },
      { id: "rank", label: "全站排行", source: "bilibili", dimensions: [
        { key: "view", label: "播放" },
        { key: "like", label: "点赞" },
        { key: "coin", label: "投币" },
        { key: "fav", label: "收藏" },
        { key: "reply", label: "评论" },
        { key: "share", label: "分享" },
      ] },
    ],
  },
  { id: "kuaishou", name: "快手", group: "视频娱乐", tabs: [{ id: "hot", label: "热点榜", source: "tophub", node: "MZd7PrPerO" }] },
  { id: "acfun", name: "AcFun", group: "视频娱乐", tabs: [{ id: "hot", label: "全站综合榜", source: "tophub", node: "qENeYpdY49" }] },
  { id: "36kr", name: "36氪", group: "科技开发", tabs: [{ id: "hot", label: "24小时热榜", source: "tophub", node: "Q1Vd5Ko85R" }] },
  { id: "ithome", name: "IT之家", group: "科技开发", tabs: [{ id: "hot", label: "热榜", source: "tophub", node: "74Kvx59dkx" }] },
  { id: "sspai", name: "少数派", group: "科技开发", tabs: [{ id: "hot", label: "热门文章", source: "tophub", node: "Y2KeDGQdNP" }] },
  { id: "juejin", name: "掘金", group: "科技开发", tabs: [{ id: "hot", label: "热榜", source: "tophub", node: "rYqoXz8dOD" }] },
  {
    id: "github",
    name: "GitHub",
    group: "科技开发",
    tabs: [
      { id: "daily", label: "今日", source: "github-trending", since: "daily" },
      { id: "weekly", label: "本周", source: "github-trending", since: "weekly" },
      { id: "monthly", label: "本月", source: "github-trending", since: "monthly" },
    ],
  },
  // ---------- 财经（国内） ----------
  { id: "xueqiu", name: "雪球", group: "财经", tabs: [{ id: "hot", label: "今日话题", source: "tophub", node: "X12owXzvNV" }] },
  { id: "eastmoney-guba", name: "东方财富股吧", group: "财经", tabs: [{ id: "hot", label: "热榜", source: "tophub", node: "rx9ozQbeXb" }] },
  {
    id: "wallstreetcn",
    name: "华尔街见闻",
    group: "财经",
    tabs: [
      { id: "daily", label: "日排行", source: "tophub", node: "G2me3ndwjq" },
      { id: "news", label: "最新资讯", source: "tophub", node: "wWmoO8kv4E" },
      { id: "weekly", label: "周排行", source: "tophub", node: "ENeYEXpeY4" },
    ],
  },
  { id: "cls", name: "财联社", group: "财经", tabs: [{ id: "hot", label: "热门文章", source: "tophub", node: "qndg5MpoLl" }] },
  { id: "sina-finance", name: "新浪财经", group: "财经", tabs: [{ id: "hot", label: "国内滚动", source: "tophub", node: "JndkwJAd3V" }] },
  {
    id: "yicai",
    name: "第一财经",
    group: "财经",
    tabs: [
      { id: "top", label: "头条", source: "tophub", node: "1Vd5rL8e85" },
      { id: "week", label: "新闻周榜", source: "tophub", node: "0MdKam4ow1" },
    ],
  },
  { id: "investing-cn", name: "英为财情", group: "财经", tabs: [{ id: "hot", label: "最热门新闻", source: "tophub", node: "b0vm4p8oB1" }] },
  { id: "gelonghui", name: "格隆汇", group: "财经", tabs: [{ id: "hot", label: "热文日排行", source: "tophub", node: "KGoRAk1el6" }] },
  { id: "eec", name: "经济观察网", group: "财经", tabs: [{ id: "hot", label: "每日热新闻", source: "tophub", node: "DOvn8x1eEB" }] },
  { id: "21jingji", name: "21财经", group: "财经", tabs: [{ id: "hot", label: "热门", source: "tophub", node: "4Kvx5R0dkx" }] },
  { id: "jisilu", name: "集思录", group: "财经", tabs: [{ id: "hot", label: "今日热门榜", source: "tophub", node: "47o8K20eMm" }] },
  { id: "nikkei-cn", name: "日经中文网", group: "财经", tabs: [{ id: "hot", label: "每日最新", source: "tophub", node: "3QeLXl9e7k" }] },

  // ---------- 国际财经 ----------
  { id: "yahoo-finance", name: "Yahoo Finance", group: "国际财经", tabs: [{ id: "hot", label: "Top News", source: "rss", url: "https://finance.yahoo.com/news/rssindex" }] },
  { id: "cnbc", name: "CNBC", group: "国际财经", tabs: [{ id: "hot", label: "Top News", source: "rss", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" }] },
  { id: "marketwatch", name: "MarketWatch", group: "国际财经", tabs: [{ id: "hot", label: "Top Stories", source: "rss", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" }] },
  { id: "investing", name: "Investing.com", group: "国际财经", tabs: [{ id: "hot", label: "News", source: "rss", url: "https://www.investing.com/rss/news.rss" }] },
  { id: "ftchinese", name: "FT中文网", group: "国际财经", tabs: [{ id: "hot", label: "新闻", source: "rss", url: "https://www.ftchinese.com/rss/news" }] },

  {
    id: "hackernews",
    name: "Hacker News",
    group: "国际视野",
    tabs: [
      { id: "top", label: "Top", source: "hn", type: "top" },
      { id: "best", label: "Best", source: "hn", type: "best" },
      { id: "new", label: "New", source: "hn", type: "new" },
    ],
  },
  {
    id: "reddit",
    name: "Reddit",
    group: "国际视野",
    tabs: [
      { id: "hot", label: "Hot", source: "reddit", sort: "hot" },
      { id: "top", label: "Top·日", source: "reddit", sort: "top" },
      { id: "controversial", label: "Controversial", source: "reddit", sort: "controversial" },
    ],
  },
];

const FETCHERS = {
  tophub: (tab) => fetchTophub(tab.node),
  bilibili: () => fetchBilibiliRank(),
  reddit: (tab) => fetchReddit(tab.sort),
  hn: (tab) => fetchHN(tab.type),
  "github-trending": (tab) => fetchGithubTrending(tab.since),
  "rsshub-nga": () => fetchNga(),
  rss: (tab) => fetchRss(tab.url),
};

/* ---------- 主流程 ---------- */

async function main() {
  const boards = [];
  for (const board of BOARDS) {
    console.log(`>>> ${board.name}`);
    const tabs = [];
    for (const tab of board.tabs) {
      const t = { id: tab.id, label: tab.label };
      if (tab.dimensions) t.dimensions = tab.dimensions;
      try {
        const items = await FETCHERS[tab.source](tab);
        t.items = items;
        t.updateTime = new Date().toISOString();
        console.log(`    ${tab.label}: ${items.length} 条`);
      } catch (e) {
        t.error = String(e.message || e);
        t.items = [];
        console.log(`    ${tab.label}: FAIL - ${t.error}`);
      }
      tabs.push(t);
    }
    boards.push({
      id: board.id,
      name: board.name,
      group: board.group,
      tabs,
    });
    await new Promise((r) => setTimeout(r, 1200 + Math.floor(Math.random() * 800))); // 温和限速，避免被限流
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    source: "tophub.today / bilibili / reddit / hackernews / github / rsshub",
    boards,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log("✔ 已写入", OUT);
}

main().catch((e) => {
  console.error("致命错误:", e);
  process.exit(1);
});
