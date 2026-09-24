import { PROJECT_NAME, PROJECT_SYMBOL, PROJECT_TAGLINE, PROJECT_NUMBER, NETWORK_CONFIG, EXECUTION_MODE, GENESIS_CONFIG } from "/config.js";
import { startObservationFeed } from "/services.js";
import { getRecord, getRuntime, getWalletSnapshots, startAgentFeed, onStateChange, ingestObservation } from "/agent.js";
import { formatEasternTime, formatEasternDateTime, formatEasternRelativeTime, isEasternToday, last24Hours, easternHour } from "/time.js";
import { renderLoop, bindLoops, lastEntered } from "/loop.js";
import { tokenCaMarkup, bindTokenCa } from "/token-ca.js";

const routes = ["day", "holdings", "board", "chain", "brain"];
const route = (() => { const p = location.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).pop(); return routes.includes(p) ? p : "home"; })();
let observation = null, runtime = getRuntime();
let previousPrices = new Map(), priceFlashes = new Map();
const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
const num = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const fmt = (value, digits = 2) => num(value) === null ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
const missingText = () => observation ? "unavailable" : "loading…";
const usd = value => num(value) === null ? missingText() : "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatTokenPrice(value) {
  const parsed = num(value);
  if (parsed === null) return missingText();
  if (parsed === 0 || Math.abs(parsed) >= 1) return usd(parsed);
  if (Math.abs(parsed) < 1e-12) return "$" + parsed.toExponential(2);
  const digits = Math.min(12, Math.max(2, 3 - Math.floor(Math.log10(Math.abs(parsed)))));
  return "$" + parsed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}
const priceUsd = formatTokenPrice;
const compactUsd = value => {
  const parsed = num(value);
  if (parsed === null) return missingText();
  const absolute = Math.abs(parsed);
  const unit = absolute >= 1e9 ? [1e9, "B"] : absolute >= 1e6 ? [1e6, "M"] : absolute >= 1e3 ? [1e3, "K"] : null;
  if (!unit) return formatTokenPrice(parsed);
  return "$" + (parsed / unit[0]).toLocaleString("en-US", { maximumFractionDigits: 2 }) + unit[1];
};
const pct = value => num(value) === null ? "—" : (Number(value) >= 0 ? "+" : "") + Number(value).toFixed(2) + "%";
const available = (value, digits = 2) => num(value) === null ? missingText() : fmt(value,digits);
const availablePct = value => num(value) === null ? missingText() : pct(value);
const short = (value, a = 8, b = 6) => value ? String(value).slice(0, a) + "…" + String(value).slice(-b) : "—";
const et = (value, date = false) => date ? formatEasternDateTime(value) : formatEasternTime(value);
const age = formatEasternRelativeTime;
const c = () => observation?.chain || {};
const w = () => observation?.wallet || {};
const m = () => observation?.market || { assets: [], quoteCount: 0 };
const ext = () => Array.isArray(observation?.externalSignals) ? observation.externalSignals : (observation?.external || []);
const assets = () => Array.isArray(m().assets) ? m().assets : [];
const boardAssets = () => {
  const list = assets(), project = m().projectToken;
  if (!project?.mint) return list;
  return [{ ...project, project: true }, ...list.filter(item => mint(item) !== project.mint)];
};
const status = key => !observation ? "loading…" : observation.sourceStatus?.[key] || (observation.stale ? "stale" : "unavailable");
const tone = value => value === "live" ? "c-up" : value === "stale" ? "c-hold" : value === "loading…" ? "c-dim" : "c-down";
const mint = item => item?.mint || item?.address || "";
const move = item => item?.change24h ?? item?.dailyMovePct;
const latestTx = () => observation?.lastTransaction || null;
const candidateFor = item => (runtime.latestDecision?.candidates || []).find(candidate => {
  const itemMint = mint(item);
  if (itemMint && candidate.mint) return candidate.mint === itemMint;
  return !itemMint && !candidate.mint && Boolean(item.symbol) && candidate.symbol === item.symbol;
}) || null;

function nav(name) { const active = route === name ? " is-current" : ""; return `${name === "day" ? githubNav() : ""}<a href="/${name}" class="nav-lnk${active}"${active ? ' aria-current="page"' : ""}>${name}</a>`; }
function githubNav() { return '<a href="https://github.com/theovarne/soryn" target="_blank" rel="noopener noreferrer" class="nav-lnk nav-github" aria-label="SORYN GitHub" title="GitHub"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.23.48-2.69-.95-2.69-.95-.36-.92-.88-1.17-.88-1.17-.73-.5.06-.49.06-.49.81.06 1.24.83 1.24.83.72 1.23 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.7 7.7 0 0 1 8 4.73c.68 0 1.36.09 2 .27 1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.74.54 1.49 0 1.08-.01 1.95-.01 2.21 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg></a>'; }
function section(label, extra = "") { return `<div class="sec"><div class="sec-rule"></div><div class="t-strong c-label"><span>${label}</span>${extra}</div><div class="sec-rule"></div></div>`; }
function row(label, value, alt = false, cls = "c-text2") { return `<div class="row row-main t-base${alt ? " row-alt" : ""}" style="grid-template-columns:150px minmax(0,1fr);gap:8px"><span class="cell c-label">${label}</span><span class="cell ${cls}">${value}</span></div>`; }
function heading(title, sub) { return `<div class="page-title t-head c-text">${title}</div><div class="t-meta c-dim">${sub}</div>`; }
function walletControl(address, explorerUrl, full = false) {
  if (!address) return missingText();
  const label = full ? address : short(address,7,5);
  return `<span class="wallet-control" title="${esc(address)}"><button type="button" class="text-button t-base c-text2" data-copy="${esc(address)}">${esc(label)}</button><a class="lnk t-base" href="${esc(explorerUrl || NETWORK_CONFIG.accountExplorer + "/" + address)}" target="_blank" rel="noreferrer" aria-label="open wallet in Solscan">↗</a></span>`;
}
function shell(body) {
  const last = getRecord()[0];
  return `<main class="col"><header><div class="site-header"><div class="brand-lockup"><a class="brand t-head c-text" href="/">${PROJECT_NAME}</a><span class="t-meta c-faint">${PROJECT_NUMBER}</span></div><nav class="nav t-base">${routes.map(nav).join("")}<a href="https://x.com/soryn_day" target="_blank" rel="noreferrer" class="nav-lnk">x</a></nav></div><nav class="mobile-nav t-base">${routes.map(nav).join("")}<a href="https://x.com/soryn_day" target="_blank" rel="noreferrer" class="nav-lnk">x</a></nav><div class="last-line t-meta"><span class="c-dim">last thing it did</span>&nbsp;<span class="c-label">${last ? esc(last.text) + " · " + age(last.timestamp) : "no record yet"}</span>${tokenCaMarkup(observation?.projectTokenConfig)}</div></header>${body}<footer class="footer-note t-meta c-dim"><span>${PROJECT_NAME} · solana snapshot</span><span>${c().network || NETWORK_CONFIG.name} · ${c().cluster || NETWORK_CONFIG.cluster} · all times ET</span></footer></main><div id="tooltip" class="tooltip t-meta" hidden></div>`;
}
function tile(item) {
  const symbol = item.symbol || short(mint(item), 4, 3), movement = move(item), project = Boolean(item.project || item.feeds?.includes("project"));
  const parts = [item.name || symbol, "mint " + (mint(item) || "—")];
  if (num(item.price) !== null) parts.push("price " + priceUsd(item.price));
  if (num(movement) !== null) parts.push("24h " + pct(movement));
  if (num(item.liquidityUsd) !== null) parts.push("liquidity " + compactUsd(item.liquidityUsd));
  if (num(item.marketCap) !== null) parts.push("market cap " + compactUsd(item.marketCap));
  const completeness = [item.price, item.liquidityUsd, item.buyVolume ?? item.sellVolume ?? item.buys ?? item.sells ?? item.traders, item.holderCount, item.organicScore].filter(value => num(value) !== null).length;
  parts.push("data " + completeness + " / 5");
  if (project) parts.push("project token · " + (item.marketDataStatus || observation?.projectTokenConfig?.status || "indexing"));
  const flash = priceFlashes.get(mint(item));
  return '<button type="button" class="tile' + (num(movement) > 0 ? ' up' : num(movement) < 0 ? ' down' : '') + (project ? ' project-token' : '') + (flash ? ' price-flash-' + flash : '') + '" data-symbol="' + esc(symbol) + '" data-mint="' + esc(mint(item)) + '" data-tooltip="' + esc(parts.join("\n")) + '" aria-label="' + esc((project ? 'project token ' : '') + symbol + ', ' + priceUsd(item.price) + ', 24h ' + pct(movement)) + '"><span class="tile-symbol t-strong c-text">' + esc(symbol) + '</span><span class="t-meta c-text2">' + priceUsd(item.price) + '</span><span class="t-meta c-label">' + pct(movement) + '</span>' + (project ? '<span class="tile-project-tag t-meta">project</span>' : '') + '</button>';
}
function externalTile(item) {
  const symbol = item.symbol || "—", movement = move(item);
  const currentStatus = observation?.fallback === "saved snapshot" && item.status === "live" ? "stale" : item.status || status("external");
  const updatedAt = item.lastUpdated || item.updatedAt || item.quoteAt || observation?.sourceHealth?.coingecko?.lastSuccess || observation?.timestamp;
  const updated = et(updatedAt);
  const detail = [symbol, "price " + priceUsd(item.price), "24h " + availablePct(movement), "source " + (item.source || "external reference"), "updated " + updated, "status " + currentStatus].join("\n");
  return '<div class="tile external-tile' + (num(movement) > 0 ? ' up' : num(movement) < 0 ? ' down' : '') + '" data-tooltip="' + esc(detail) + '" tabindex="0" role="group" aria-label="' + esc(symbol + ' reference: ' + priceUsd(item.price) + ', 24h ' + availablePct(movement) + ', ' + currentStatus) + '"><span class="t-strong c-text">' + esc(symbol) + '</span><span class="t-meta c-text2">' + priceUsd(item.price) + '</span><span class="t-meta c-label">' + availablePct(movement) + '</span><span class="t-meta ' + tone(currentStatus) + '">' + esc(currentStatus) + ' · ' + esc(updated) + '</span></div>';
}
function board(compact = false) {
  const list = compact ? boardAssets().slice(0,90) : boardAssets(), counts = m().counts || {};
  const featured = list.slice(0,2).map(item => '<div class="mover neutral"><span class="mover-tag t-meta c-label">' + (item.project ? 'project' : 'quoted') + '</span><span class="t-head c-text">' + esc(item.symbol || short(mint(item),4,3)) + '</span><span class="t-base c-text2">' + priceUsd(item.price) + '</span><span class="t-meta c-dim" title="' + esc(usd(item.liquidityUsd)) + '">liquidity ' + compactUsd(item.liquidityUsd) + '</span></div>').join("");
  return '<div class="board-head"><span class="t-strong c-label">solana market universe</span><span class="board-head-right"><span class="t-meta c-dim">jupiter quotes · ' + status("market") + '</span>' + (compact ? '<a href="/board" class="lnk t-base">the whole list</a>' : '') + '</span></div><div class="heatmap"><div class="movers">' + (featured || '<div class="mover neutral"><span class="t-meta c-dim">' + (observation ? 'no snapshot yet' : 'loading…') + '</span></div>') + '</div><div class="tiles">' + (list.map(tile).join("") || '<div class="empty-state t-meta">' + (observation ? 'market snapshot unavailable' : 'loading…') + '</div>') + '</div></div><div class="board-foot t-meta c-dim"><span>tokens ' + (observation ? m().universeSize ?? list.length : "—") + '</span><span>quotes ' + (observation ? m().quoteCount || 0 : "—") + '</span><span>trending ' + (counts.trending ?? "—") + ' · traded ' + (counts.traded ?? "—") + ' · organic ' + (counts.organic ?? "—") + ' · recent ' + (counts.recent ?? "—") + '</span><span>source jupiter · ' + (observation?.stale ? "saved snapshot · stale" : observation ? "as of " + et(m().sourceTimestamp) : "loading…") + '</span></div>';
}
function holdingsRows() {
  const data = w(), list = [{ symbol:"SOL", balance:data.solBalance ?? data.nativeBalance, valueUsd:data.nativeValueUsd, mint:"native", tokenProgram:"system" }, ...(data.positions || [])];
  if (!data.address && !list.some(item => item.balance != null)) return '<div class="empty-state t-meta">' + (observation ? 'no wallet snapshot yet' : 'loading…') + '</div>';
  return list.map((item, i) => `<div class="row t-base${i % 2 ? " row-alt" : ""}" style="grid-template-columns:92px 110px 120px minmax(0,1fr);gap:8px"><span class="cell t-strong c-text">${esc(item.symbol || short(item.mint,4,3))}</span><span class="cell c-text2">${fmt(item.balance,9)}</span><span class="cell c-label">${usd(item.valueUsd)}</span><span class="cell c-dim">${esc(item.mint || "—")} · ${esc(item.tokenProgram || "token")}</span></div>`).join("");
}
function chainRows() {
  const data = c();
  return `<div>${row("network",data.network || NETWORK_CONFIG.name)}${row("cluster",data.cluster || NETWORK_CONFIG.cluster,true)}${row("slot",num(data.slot) == null ? missingText() : fmt(data.slot,0))}${row("block height",num(data.blockHeight) == null ? missingText() : fmt(data.blockHeight,0),true)}${row("epoch",data.epoch?.epoch == null ? missingText() : fmt(data.epoch.epoch,0))}${row("latest blockhash",data.latestBlockhash ? short(data.latestBlockhash,14,10) : missingText(),true)}${row("commitment",data.commitment || NETWORK_CONFIG.commitment)}${row("priority fee",data.priorityFeeSampleLamports == null ? missingText() : fmt(data.priorityFeeSampleLamports,0) + " lamports",true)}${row("status",'<span class="' + tone(status("chain")) + '">' + status("chain") + "</span>")}</div>`;
}
function walletRows() {
  const data = w(), latest = data.latestActivity || {}, tx = latestTx();
  const latestStatus = tx?.status || latest.confirmationStatus || (observation ? 'none' : 'loading…');
  const transactionField = value => tx || latest.signature ? value : observation ? '—' : 'loading…';
  return `<div>${row("address",walletControl(data.address,data.explorerUrl))}${row("sol balance",data.solBalance == null ? missingText() : fmt(data.solBalance,9) + " SOL",true)}${row("token accounts",num(data.tokenAccountsCount) == null ? missingText() : fmt(data.tokenAccountsCount,0))}${row("recent signatures",observation ? fmt(data.recentSignatures?.length,0) : missingText(),true)}</div><div>${row("latest signature",tx ? short(tx.signature) : latest.signature ? short(latest.signature) : observation ? "none" : "loading…")}${row("status",latestStatus,true)}${row("slot",transactionField(num(tx?.slot ?? latest.slot) == null ? missingText() : fmt(tx?.slot ?? latest.slot,0)))}${row("block time",transactionField(tx?.blockTime ? et(new Date(tx.blockTime * 1000).toISOString(),true) : missingText()),true)}${row("fee",transactionField(tx?.feeLamports == null ? missingText() : fmt(tx.feeLamports,0) + " lamports"))}${row("programs",transactionField(tx?.programs?.length ? esc(tx.programs.join(", ")) : missingText()),true)}${row("compute units",transactionField(tx?.computeUnits == null ? missingText() : fmt(tx.computeUnits,0)))}${row("error",tx?.error || "none",true)}</div>`;
}
function loopTable() {
  const rows = [["wake","timer fires; capped at " + GENESIS_CONFIG.maxActsPerDay + " acts/day and " + GENESIS_CONFIG.minMinutesBetweenActs + " min apart"],["look","one coherent snapshot of wallet, chain, token universe and market context"],["weigh","scores candidates; doing nothing is always included"],["act","at most one action; simulation does not sign a transaction"],["rest",runtime.nextAllowedWake ? "next local wake " + et(runtime.nextAllowedWake,true) : "awaiting first local wake"]];
  return `<div class="table-scroll"><div>${rows.map(([name,text],i) => `<div class="row t-base${i % 2 ? " row-alt" : ""}" style="grid-template-columns:64px minmax(0,1fr) 70px;gap:8px"><span class="cell t-strong c-text2">${name}</span><span class="cell c-label">${text}</span><span class="cell c-dim">${runtime.agentState === name ? "now" : age(lastEntered(name))}</span></div>`).join("")}</div></div>`;
}
function rawResponse() {
  const data = c(), account = w(), market = m();
  return {
    schemaVersion:"soryn-solana-inspection-v1",
    timestamp:observation?.timestamp || null,
    sourceStatus:observation?.sourceStatus || {},
    sourceHealth:observation?.sourceHealth || {},
    provenance:observation?.provenance || {},
    chain:{network:data.network || "solana",cluster:data.cluster || NETWORK_CONFIG.cluster,slot:data.slot ?? null,blockHeight:data.blockHeight ?? null,epoch:data.epoch || null,latestBlockhash:data.latestBlockhash || null,commitment:data.commitment || NETWORK_CONFIG.commitment,rpc:data.rpc || NETWORK_CONFIG.rpc,status:data.status || status("chain")},
    wallet:{address:account.address || null,solBalance:account.solBalance ?? null,nativeBalance:account.nativeBalance ?? account.solBalance ?? null,portfolioUsd:account.portfolioUsd ?? null,positions:account.positions || [],tokenAccounts:account.tokenAccounts || [],tokenAccountsCount:account.tokenAccountsCount ?? null,splTokenAccounts:account.splTokenAccounts ?? null,token2022Accounts:account.token2022Accounts ?? null,recentSignatures:account.recentSignatures || [],latestActivity:account.latestActivity || null,explorerUrl:account.explorerUrl || null},
    market:{assets:market.assets || [],projectToken:market.projectToken || null,nativeSolPrice:market.nativeSolPrice ?? null,universeSize:market.universeSize ?? market.assets?.length ?? 0,trendingCount:market.trendingCount ?? market.counts?.trending ?? 0,topTradedCount:market.topTradedCount ?? market.counts?.traded ?? 0,topOrganicCount:market.topOrganicCount ?? market.counts?.organic ?? 0,recentCount:market.recentCount ?? market.counts?.recent ?? 0,counts:market.counts || {},endpoints:market.endpoints || [],quotedTokens:market.quotedTokens ?? market.quoteCount ?? 0,quoteCount:market.quoteCount ?? 0,sourceTimestamp:market.sourceTimestamp || null},
    external:ext(),
    lastTransaction:latestTx(),
    executionMode:EXECUTION_MODE
  };
}
function home() {
  const account = w(), records = getRecord(), acts = records.filter(item => item.type === "act");
  return shell(`<div class="spacer-32"></div><section class="hero"><div class="hero-logo"><img src="/assets/soryn-logo.png" alt=""></div><div class="t-head c-text">soryn lives on solana.<br>it was handed one wallet and left alone.</div><div class="spacer-12"></div><div class="t-body c-text2">${PROJECT_TAGLINE} while this page is open, it wakes on a guarded local schedule, reads one coherent snapshot of its <span class="chip t-base">agent wallet</span>, <span class="chip t-base">solana</span> and the <span class="chip t-base">token universe</span>, then weighs one action against doing nothing. missing data stays missing. every simulated decision is written down; no transaction is presented as live.</div><div class="spacer-6"></div><a href="/brain" class="lnk t-base">how it decides</a><div class="spacer-16"></div><div class="hero-rule"></div><div class="spacer-14"></div><div class="t-strong"><span class="c-label">right now:</span> <span class="c-text">${runtime.agentState === "rest" ? "resting" : runtime.agentState}</span> <span class="t-meta c-up system-live-inline">system live</span></div><div class="spacer-12"></div><div class="button-row"><a href="/holdings" class="btn t-strong">see the wallet</a><a href="/day" class="btn t-strong">watch the day</a></div><div class="spacer-14"></div><div class="t-base"><span class="c-label">agent wallet</span> ${walletControl(account.address,account.explorerUrl)}</div><div class="spacer-6"></div><div class="t-meta c-dim">public address · private key never exposed · ${EXECUTION_MODE}</div></section><div class="spacer-28"></div>${section("live",'<span class="live-dot" aria-label="' + status("chain") + '"></span>')}<div class="spacer-10"></div><div class="stats">${[[usd(account.portfolioUsd),"balance in dollars"],[acts.length,"things it has done"],[records.filter(item => item.type === "act" && Date.now() - new Date(item.timestamp).getTime() < 3600000).length,"in the last hour"],[observation ? (account.tokenAccountsCount ?? (account.positions || []).length) : "—","token accounts"],[observation ? boardAssets().length : "—","tokens watched"],[observation ? ext().length : "—","external references"]].map(([value,label]) => `<div class="stat"><div class="stat-value t-stat c-text">${value}</div><div class="stat-label t-base c-label">${label}</div></div>`).join("")}</div><div class="spacer-8"></div><div class="status-notes t-meta c-dim"><span>snapshot ${et(observation?.timestamp)}</span><span class="${tone(status("market"))}">market ${status("market")}</span><span class="${tone(status("chain"))}">chain ${status("chain")}</span><span>${EXECUTION_MODE}</span></div><div class="spacer-28"></div><div class="two"><div>${section("what it did")}<div class="spacer-10"></div>${acts[0] ? row(et(acts[0].timestamp),esc(acts[0].text)) : '<div class="empty-state t-meta">no acts yet</div>'}</div><div>${section("what it holds")}<div class="spacer-10"></div>${holdingsRows()}</div></div><div class="spacer-28"></div>${section("the board")}<div class="spacer-10"></div>${board(true)}<div class="spacer-28"></div>${section("the chain")}<div class="spacer-10"></div><div class="two">${chainRows()}<div class="terminal raw-code t-meta">${esc(JSON.stringify(latestTx() || {status:"none"},null,2))}</div></div><div class="spacer-28"></div>${section("the loop")}<div class="spacer-10"></div><div class="two"><div class="loop-figure">${renderLoop(false)}</div>${loopTable()}</div>`);
}
function day() {
  const items = getRecord().filter(item => Date.now() - new Date(item.timestamp).getTime() < 86400000);
  const hours = last24Hours().map(start => ({start,count:items.filter(item => new Date(item.timestamp) >= start && new Date(item.timestamp) < new Date(start.getTime()+3600000)).length}));
  return shell(`${heading("day","every wake, snapshot, decision, act, failure and quiet hour — ET.")}<div class="page-stack"><section>${section("the last twenty four hours")}<div class="spacer-10"></div><div style="display:grid;grid-template-columns:repeat(24,1fr);gap:3px;height:58px">${hours.map(({start,count}) => `<div title="${et(start.toISOString())}" style="background:${count > 3 ? "var(--up)" : count > 1 ? "var(--heat-up-2)" : count ? "var(--heat-up-1)" : "var(--panel)"}"></div>`).join("")}</div></section><section>${section("counts since midnight · ET")}<div class="spacer-10"></div>${row("events",getRecord().filter(item => isEasternToday(item.timestamp)).length)}${row("acts",getRecord().filter(item => item.type === "act" && isEasternToday(item.timestamp)).length,true)}${row("execution mode",EXECUTION_MODE)}</section><section>${section("the record")}<div class="spacer-10"></div>${items.map((item,i) => row(et(item.timestamp).replace(" ET",""),esc(item.type) + " · " + esc(item.text) + " · " + age(item.timestamp),i % 2)).join("") || '<div class="empty-state t-meta">no events yet</div>'}</section><section>${section("a plain telling")}<div class="spacer-10"></div><div class="prose t-body c-text2"><p>the loop may wake no more than once every ${GENESIS_CONFIG.minMinutesBetweenActs} minutes. it reads one Solana snapshot, weighs candidates with doing nothing included, and performs at most one simulated action.</p><p>this deployment is in ${EXECUTION_MODE}; a simulated act never receives a made-up transaction signature.</p></div></section></div>`);
}
function holdings() {
  const account = w(), snapshots = getWalletSnapshots(), values = snapshots.map(item => num(item.portfolioUsd)).filter(item => item !== null);
  return shell(`${heading("holdings","the public Solana wallet and its saved balance snapshots.")}<div class="page-stack"><section>${section("agent wallet")}<div class="spacer-10"></div><div class="wallet-address">${walletControl(account.address,account.explorerUrl)}<span class="t-meta c-dim">click address to copy</span></div><div class="t-meta c-dim">public address · private key never exposed · no user wallet connection</div></section><section>${section("balance")}<div class="spacer-10"></div><div class="key-grid"><div><div class="t-meta c-label">portfolio</div><div class="t-stat c-text">${usd(account.portfolioUsd)}</div><div class="t-meta c-dim">native ${account.solBalance == null ? missingText() : fmt(account.solBalance,9) + " SOL"}</div><div class="t-meta c-dim">native value ${usd(account.nativeValueUsd)}</div></div><div>${row("highest snapshot",values.length ? usd(Math.max(...values)) : missingText())}${row("lowest snapshot",values.length ? usd(Math.min(...values)) : missingText(),true)}${row("snapshots kept",snapshots.length)}${row("token accounts",fmt(account.tokenAccountsCount,0),true)}</div></div></section><section>${section("what it holds")}<div class="spacer-10"></div>${holdingsRows()}</section><section>${section("recent signatures")}<div class="spacer-10"></div>${(account.recentSignatures || []).slice(0,8).map((item,i) => row(short(item.signature),item.confirmationStatus || missingText(),i % 2)).join("") || '<div class="empty-state t-meta">' + (observation ? 'no signatures found' : 'loading…') + '</div>'}</section><section>${section("project token")}<div class="spacer-10"></div>${row(PROJECT_SYMBOL + " mint",observation ? (observation.projectTokenConfig?.mint ? esc(observation.projectTokenConfig.mint) : esc(observation.projectTokenConfig?.status || 'awaiting mint')) : 'loading…')}</section></div>`);
}
function boardPage() { return shell(heading("board","Solana token universe and external reference prices.") + '<div class="page-stack"><section>' + section("the whole list") + '<div class="spacer-10"></div>' + board(false) + '</section><section>' + section("external references") + '<div class="spacer-10"></div><div class="board-head"><span class="t-strong c-label">BTC / ETH / SOL</span><span class="t-meta c-dim">public reference · ' + status("external") + '</span></div><div class="tiles external-tiles">' + (ext().map(externalTile).join("") || '<div class="empty-state t-meta">' + (observation ? 'external references unavailable' : 'loading…') + '</div>') + '</div></section></div>'); }
function chainPage() { return shell(`${heading("chain","the public state SORYN can see on Solana.")}<div class="page-stack"><section>${section("network")}<div class="spacer-10"></div><div class="two">${chainRows()}<div class="terminal t-meta"><div class="terminal-line"><span class="c-dim">rpc</span><span class="c-text2">${c().rpc || NETWORK_CONFIG.rpc}</span></div><div class="terminal-line"><span class="c-dim">commitment</span><span class="c-text2">${c().commitment || NETWORK_CONFIG.commitment}</span></div></div></div></section><section>${section("wallet")}<div class="spacer-10"></div><div class="two">${walletRows()}<div>${row("latest transaction",latestTx()?.signature ? short(latestTx().signature) : "none")}${row("status",latestTx()?.status || "unavailable",true)}${row("error",latestTx()?.error || "none")}</div></div></section><section>${section("raw response")}<div class="spacer-10"></div><div class="terminal raw-code t-meta">${esc(JSON.stringify(rawResponse(),null,2))}</div></section></div>`); }
function brain() {
  const cfg = GENESIS_CONFIG, decision = getRecord().find(item => item.type === "decision");
  const rules = [["maximum acts per day",cfg.maxActsPerDay,"acts"],["minimum time between acts",cfg.minMinutesBetweenActs,"minutes"],["wallet slice",cfg.walletSlice * 100,"percent"],["minimum liquidity",cfg.minimumLiquidityUsd ?? cfg.minimumPoolUsd,"usd"],["do nothing margin",cfg.doNothingMargin,"score"],["noise",cfg.noise,"score"]];
  return shell(`${heading("brain","the guarded loop and its immutable genesis rules.")}<div class="page-stack"><section>${section("the loop")}<div class="spacer-10"></div><div class="brain-loop">${renderLoop(true)}</div>${loopTable()}</section><section>${section("where things go")}<div class="spacer-10"></div><svg class="network-map" viewBox="0 0 1200 260" role="img" aria-label="wallet, token universe, liquidity, market context"><text x="600" y="130" text-anchor="middle" fill="var(--text)">wallet</text><text x="180" y="50" text-anchor="middle" fill="var(--label)">token universe</text><text x="180" y="220" text-anchor="middle" fill="var(--label)">liquidity</text><text x="1020" y="50" text-anchor="middle" fill="var(--label)">market context</text><text x="1020" y="220" text-anchor="middle" fill="var(--label)">sleep</text></svg></section><section>${section("genesis rules · read only")}<div class="spacer-10"></div>${rules.map(([name,value,unit],i) => row(name,String(value) + " " + unit,i % 2)).join("")}</section><section>${section("last decision")}<div class="spacer-10"></div>${decision ? row("chosen",esc(decision.text)) + row("reason",esc(decision.reason || "—"),true) : '<div class="empty-state t-meta">no decision yet</div>'}</section><section>${section("in words")}<div class="spacer-10"></div><div class="prose t-body c-text2"><p>${PROJECT_NAME} follows rest → wake → look → weigh → act or rest → rest.</p><p>look creates one Solana observation from wallet, chain, token prices, liquidity and external references. doing nothing is always a formal candidate.</p><p>execution is ${EXECUTION_MODE}. no private key reaches the browser and no simulated act is given a transaction signature.</p></div></section></div>`); }

const pages = { home, day, holdings, board: boardPage, chain: chainPage, brain };
function bind() {
  document.querySelectorAll("a.nav-lnk").forEach(a => { if (a.textContent.trim().toLowerCase() === "x") { a.href = "https://x.com/soryn_day"; a.target = "_blank"; a.rel = "noreferrer"; } });
  const tooltip = document.querySelector("#tooltip");
  document.querySelectorAll("[data-tooltip]").forEach(item => {
    const show = event => {
      if (!tooltip) return;
      if (tooltip.textContent !== item.dataset.tooltip) tooltip.textContent = item.dataset.tooltip;
      tooltip.hidden = false;
      const point = event.touches?.[0] || event, anchor = item.getBoundingClientRect();
      const pointerX = Number.isFinite(point.clientX) ? point.clientX : anchor.left;
      const pointerY = Number.isFinite(point.clientY) ? point.clientY : anchor.bottom;
      tooltip.style.transform = "none";
      const size = tooltip.getBoundingClientRect(), maxX = Math.max(8, innerWidth - size.width - 8), maxY = Math.max(8, innerHeight - size.height - 8);
      const x = Math.min(maxX, Math.max(8, pointerX + 12));
      const y = Math.min(maxY, Math.max(8, pointerY + size.height + 12 > innerHeight - 8 ? pointerY - size.height - 12 : pointerY + 12));
      tooltip.style.left = x + "px";
      tooltip.style.top = y + "px";
    };
    item.addEventListener("mouseenter",show); item.addEventListener("mousemove",show); item.addEventListener("focus",show); item.addEventListener("mouseleave",() => { if (tooltip) tooltip.hidden = true; }); item.addEventListener("blur",() => { if (tooltip) tooltip.hidden = true; });
  });
  document.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", async () => { const original = button.textContent; try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = "copied"; } catch { button.textContent = "copy unavailable"; } setTimeout(() => button.textContent = original,1200); }));
}
function render() { const root = document.querySelector("#app"); if (!root) return; root.innerHTML = pages[route](); bind(); bindLoops(); bindTokenCa(); }
render();
onStateChange(next => { runtime = next; render(); });
startAgentFeed();
startObservationFeed(data => {
  const nextPrices = new Map((data?.market?.assets || []).map(asset => [asset.mint, num(asset.price)]).filter(item => item[0] && item[1] !== null));
  const changes = new Map();
  for (const [address, price] of nextPrices) {
    const previous = previousPrices.get(address);
    if (previous !== undefined && price !== previous) changes.set(address, price > previous ? "up" : "down");
  }
  previousPrices = nextPrices;
  priceFlashes = changes;
  observation = data;
  ingestObservation(data);
  render();
  if (changes.size) setTimeout(() => { priceFlashes = new Map(); document.querySelectorAll('.tile.price-flash-up,.tile.price-flash-down').forEach(tile => tile.classList.remove('price-flash-up','price-flash-down')); }, 500);
});
