"use strict";
// 오른쪽 패널 — 사무실 사람들(누르면 펼쳐 자세히: 경로·세션·커밋·서브에이전트·지금 하는 일)
// + 살아 움직이는 활동 로그(한 줄씩 흘려 넣는다). 글은 전부 textContent 로만 넣는다.

const OfficePanel = (() => {
  const $ = id => document.getElementById(id);
  const t = (k, v) => I18N.t(k, v);
  const P = { people: [], sel: null, items: [], seen: new Set(), queue: [], primed: false, pick: null };
  const LOG_MAX = 60;

  // 화면의 상태 = 승인 대기 > 일(본체가 쉬어도 서브에이전트가 일하면 일하는 중) > 쉼 — office-life.js 와 같은 잣대
  const modeOf = d => (d.status === "decision" ? "decision" : d.status === "working" || d.subCount > 0 ? "working" : "rest");
  const STATUS = { decision: "ask", working: "work", rest: "rest" };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dot(color) { const d = el("i", "o-dot"); d.style.background = color; return d; }

  // ---------- 사람 목록 ----------
  function what(d, open) {
    const mode = modeOf(d);
    if (mode === "decision") return I18N.cut(I18N.ask(d.ask) || t("needs"), open ? 80 : 40);
    if (mode === "working") return I18N.act(d.doing) || (d.subCount ? t("doing.subs") : t("doing.work"));
    return open ? t("d.idle") : "";
  }
  function subLine(s) {
    const name = [s.type, s.desc].filter(Boolean).join(" · ") || t("d.subs");
    return `🐣 ${name}`;
  }
  function details(d) {
    const box = el("div", "o-more");
    if (d.path) {
      const p = el("p", "o-path");
      p.append(el("span", "o-k", t("d.path")), el("code", null, d.path));
      box.append(p);
    }
    const facts = d.source === "roster" ? [] : [t("d.sessions", { n: d.sessions || 1 })];
    if (d.commits != null) facts.push(t("d.commits", { n: d.commits }));
    if (d.pending > 1) facts.push(t("d.pending", { n: d.pending }));
    if (d.source === "transcript") facts.push(t("d.transcript"));
    if (d.roster) {                                    // 상주 에이전트(config.json roster) — 역할·도구·켜짐 여부
      if (d.role) facts.unshift(d.role);
      if (d.tool) facts.push(d.tool);
      facts.push(t(d.online === false ? "d.rosterOff" : "d.rosterOn"));
    }
    box.append(el("p", "o-facts", facts.join(" · ")));
    const subs = d.subs || [];
    if (subs.length || d.subCount) {
      box.append(el("p", "o-k o-subhead", `${t("d.subs")} ${d.subCount || subs.length}`));
      const ul = el("ul", "o-subs");
      for (const s of subs) {
        const li = el("li", null);
        li.append(el("span", "o-subname", subLine(s)), el("span", "o-subdoing", I18N.act(s.doing) || t("d.subIdle")));
        ul.append(li);
      }
      const more = (d.subCount || 0) - subs.length;
      if (more > 0) ul.append(el("li", "o-submore", t("d.more", { n: more })));
      box.append(ul);
    }
    return box;
  }
  function item(d) {
    const open = d.id === P.sel, mode = modeOf(d), cls = STATUS[mode];
    const li = el("li", "o-person" + (open ? " open" : ""));
    li.dataset.id = d.id;
    const head = el("button", "o-head");
    head.type = "button";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    head.append(dot(OfficeLife.colorOf(d.name)), el("b", null, d.name), el("span", `o-chip ${cls}`, t("status." + mode)));
    if (d.subCount) head.append(el("span", "o-chip sub", t("chip.subs", { n: d.subCount })));
    head.onclick = () => P.pick?.(d.id);
    li.append(head);
    const w = what(d, open);
    if (w) li.append(el("p", `o-doing ${cls}`, open && mode !== "rest" ? `${t("d.now")} · ${w}` : w));
    if (open) li.append(details(d));
    else for (const s of (d.subs || []).slice(0, 3)) {
      li.append(el("p", "o-sub", `${subLine(s)}${s.doing ? " — " + I18N.act(s.doing) : ""}`));
    }
    return li;
  }
  // 고른 항목이 목록 안에서 보이게 — 목록 칸만 움직이고 페이지는 그대로 둔다(폰에서 캔버스가 안 밀려나게)
  function reveal(li) {
    const box = $("office-people"), b = box.getBoundingClientRect(), r = li.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top + 4;
    else if (r.bottom > b.bottom) box.scrollTop += Math.min(r.top - b.top - 4, r.bottom - b.bottom + 4);
  }
  function render(people, sel, o = {}) {
    P.people = people || [];
    P.sel = sel || null;
    const list = $("office-people");
    const order = { decision: 0, working: 1 };
    const sorted = [...P.people].sort((a, b) => (order[modeOf(a)] ?? 2) - (order[modeOf(b)] ?? 2) || a.name.localeCompare(b.name));
    $("office-count").textContent = t("count", { n: sorted.length, w: sorted.filter(p => modeOf(p) === "working").length });
    const keep = list.scrollTop;
    list.replaceChildren(...sorted.map(item));
    list.scrollTop = keep;
    if (o.focus && P.sel) {
      const li = list.querySelector(`li[data-id="${CSS.escape(P.sel)}"]`);
      if (li) {
        reveal(li);
        li.classList.remove("flash");
        void li.offsetWidth;
        li.classList.add("flash");
      }
    }
  }

  // ---------- 요약 카드 — 결정 기다림 · 점검 대상 셋 · 병목률 · 계정 남은 한도 ----------
  // 기준은 여기서 한 곳에 둔다(바꾸기 쉽게): 10분 넘게 활동이 없는 '일하는 중', 컨텍스트 80% 이상, 압축 3회 이상.
  const QUIET_MS = 10 * 60 * 1000, CTX_HIGH = 80, COMPACT_MANY = 3, STALE_MS = 6 * 3600 * 1000;
  const lastAt = d => { const l = (d.log || [])[(d.log || []).length - 1]; return l ? Date.parse(l.at) || 0 : 0; };
  function rel(ms) {                                        // 짧은 시간 글 — 12분 · 3시간 · 2일
    const m = Math.max(1, Math.round(Math.abs(ms) / 60000));
    return m < 60 ? t("rel.m", { n: m }) : m < 1440 ? t("rel.h", { n: Math.round(m / 60) }) : t("rel.d", { n: Math.round(m / 1440) });
  }
  const names = (list, n = 2) => list.slice(0, n).map(d => d.name).join(", ") + (list.length > n ? ` +${list.length - n}` : "");
  function cards(people, quota, schedule, now = Date.now()) {
    const box = $("office-cards");
    if (!box) return;
    const list = people || [];
    const asking = list.filter(d => modeOf(d) === "decision");
    const working = list.filter(d => modeOf(d) === "working");
    const quiet = working.filter(d => d.status === "working" && now - lastAt(d) > QUIET_MS);
    const ctxHigh = list.filter(d => Number.isFinite(d.context) && d.context >= CTX_HIGH);
    const compactMany = list.filter(d => d.compactions >= COMPACT_MANY);
    const denom = asking.length + working.length;
    const pct = denom ? Math.round(asking.length / denom * 100) : 0;
    // 점검 대상 — 큰 숫자 셋(조용함·컨텍스트·압축). 하나라도 있으면 카드를 붉게
    const problems = el("div", "o-card o-problems" + (quiet.length + ctxHigh.length + compactMany.length ? " warn" : ""));
    problems.append(el("span", "o-ct", t("card.problems")));
    const trio = el("div", "o-trio");
    const flagged = [];
    for (const [label, arr] of [[t("card.quiet"), quiet], [t("card.ctx"), ctxHigh], [t("card.compact"), compactMany]]) {
      const col = el("div", "o-pcol" + (arr.length ? " on" : ""));
      col.append(el("b", null, String(arr.length)), el("small", null, label));
      trio.append(col);
      for (const d of arr) if (!flagged.includes(d)) flagged.push(d);
    }
    problems.append(trio);
    if (flagged.length) problems.append(el("small", "o-cs", names(flagged, 3)));
    // 병목률 — 승인 대기 / (승인 대기 + 일하는 중)
    const neck = el("div", "o-card o-neck" + (asking.length ? " warn" : ""));
    const nh = el("p", "o-thead");
    nh.append(el("span", "o-ct", t("card.bottleneck")), el("b", "o-cv", denom ? `${pct}%` : "—"));
    neck.append(nh);
    const nbar = el("div", "o-qbar" + (pct >= 50 ? " low" : "")), nfill = el("i"); nfill.style.width = `${pct}%`; nbar.append(nfill);
    neck.append(nbar);
    if (denom) neck.append(el("small", "o-cs", `${t("card.wait")} ${t("card.waitN", { n: asking.length })} / ${denom}${asking.length ? " · " + names(asking) : ""}`));
    const out = [problems, neck];
    if (schedule) {                                           // 오늘의 초청 — 서버가 PMOTOOLS 에서 받아 둔 오늘 일정
      const c = el("div", "o-card o-today");
      const head = el("p", "o-thead");
      head.append(el("span", "o-ct", t("card.today")), el("b", null, t("card.todayN", { n: schedule.items.length })));
      c.append(head);
      const hm = iso => new Date(iso).toLocaleTimeString(I18N.lang === "en" ? "en-GB" : "ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
      for (const it of schedule.items) {
        const start = Date.parse(it.startAt), end = it.endAt ? Date.parse(it.endAt) : start;
        const state = end < now ? "past" : start <= now ? "now" : "";
        const row = el("p", "o-trow" + (state ? " " + state : ""));
        row.append(el("time", null, it.allDay ? t("sched.allday") : hm(it.startAt)), el("span", null, it.title));
        if (it.location) row.append(el("small", null, it.location));
        c.append(row);
      }
      if (!schedule.items.length && !schedule.error) c.append(el("small", "o-cs", t("card.todayNone")));
      if (schedule.error) c.append(el("small", "o-err", t("card.todayErr." + schedule.error)));
      out.push(c);
    }
    if ((quota || []).length) {
      const q = el("div", "o-card o-quota");
      q.append(el("span", "o-ct", t("card.quota")));
      for (const x of quota) {
        const checked = x.checkedAt ? Date.parse(x.checkedAt) : 0, stale = !checked || now - checked > STALE_MS;
        const low = x.remaining <= 15;
        const row = el("div", "o-qrow");
        const main = el("div", "o-qmain");
        const foot = [];
        if (x.period) foot.push(x.period);
        if (x.resetAt) { const d = Date.parse(x.resetAt) - now; foot.push(t("card.reset", { when: d > 0 ? t("rel.in", { t: rel(d) }) : t("rel.ago", { t: rel(d) }) })); }
        if (checked) foot.push(t("card.checked", { when: t("rel.ago", { t: rel(now - checked) }) }));
        if (stale) foot.push(t("card.stale"));
        main.append(el("b", null, x.name), el("small", "o-qfoot", foot.join(" · ")));
        const val = el("div", "o-qval");
        const bar = el("div", "o-qbar" + (low ? " low" : ""));
        const fill = el("i"); fill.style.width = `${x.remaining}%`; bar.append(fill);
        val.append(el("b", low ? "low" : null, `${x.remaining}%`), bar);
        row.append(main, val);
        q.append(row);
      }
      out.push(q);
    }
    box.hidden = false;
    box.replaceChildren(...out);
  }

  // ---------- 활동 로그 ----------
  // 서버 기록(Act)과 화면이 만든 사건(출근·퇴근 등)을 같은 줄에 섞는다. 글은 그릴 때 지금 언어로 만든다.
  // uid = 중복 거르기용 열쇠(서버 기록 한 줄 = 사람 + 시각 + 활동). 사건의 key(문구 열쇠)와 다른 칸이다.
  const uidOf = (d, e) => `${d.id}|${e.at}|${e.k}|${e.a}`;
  const textOf = e => (e.act ? I18N.act(e.act) : I18N.ev(e.key, e.arg));
  function collect(people, events) {
    const now = new Set();
    for (const d of people || []) {
      for (const e of d.log || []) {
        const ms = Date.parse(e.at);
        if (!ms) continue;
        const uid = uidOf(d, e);
        now.add(uid);
        if (P.seen.has(uid) || P.items.some(x => x.uid === uid) || P.queue.some(x => x.uid === uid)) continue;
        const row = { uid, at: ms, id: d.id, name: d.name, color: OfficeLife.colorOf(d.name), act: { k: e.k, a: e.a } };
        if (P.primed) P.queue.push(row); else add(row, true);
      }
    }
    P.seen = now;                               // 지금 서버가 주는 것만 기억 — 오래 켜 둬도 안 불어난다
    for (const e of events || []) P.queue.push({ ...e, uid: `ev|${e.at}|${e.id}|${e.key}|${e.arg}`, mine: true });
    P.queue.sort((a, b) => a.at - b.at);
    P.primed = true;
  }
  function row(e, quiet) {
    const li = el("li", quiet ? "o-log" : "o-log fresh");
    li.append(el("time", null, I18N.time(e.at)), dot(e.color), el("b", null, e.name), el("span", e.mine ? "o-ev" : null, textOf(e)));
    li.dataset.at = e.at;
    li.dataset.id = e.id;
    li.onclick = () => P.pick?.(e.id, true);
    return li;
  }
  // 시간순 자리에 끼운다(맨 위가 최신) — 서버 기록은 조금 늦게 와도 제 시각 자리로
  function add(e, quiet) {
    const box = $("office-log");
    const k = P.items.findIndex(x => x.at <= e.at);
    const at = k < 0 ? P.items.length : k;
    P.items.splice(at, 0, e);
    box.insertBefore(row(e, quiet), box.children[at] || null);
    while (P.items.length > LOG_MAX) { P.items.pop(); box.lastChild?.remove(); }
  }
  function drip() {
    const e = P.queue.shift();
    if (e) add(e, false);
  }
  // 언어가 바뀌면 지금 있는 글을 전부 새 언어로
  function relabel() {
    $("office-log").replaceChildren(...P.items.map(e => row(e, true)));
    render(P.people, P.sel);
  }

  return { render, cards, collect, drip, relabel, modeOf, onPick: f => { P.pick = f; } };
})();
