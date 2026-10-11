// 表示崩れを数字で拾う。Claude in Chrome の javascript_tool に、このファイルの中身をそのまま渡して走らせる。
// ページを変えない（読むだけ）。結果は JSON の文字列で返る。拾ったものは候補なので、スクリーンショットで目で確かめてから報告する。
(() => {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const LIMIT = 15;

  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter((c) => c && !/^css-/.test(c)).slice(0, 3) : [];
    if (cls.length) s += `.${cls.join(".")}`;
    const label = el.getAttribute("aria-label") || (el.innerText || "").trim().replace(/\s+/g, " ");
    return label ? `${s} 「${label.slice(0, 40)}」` : s;
  };
  const visible = (el, r) => {
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) !== 0;
  };
  // 祖先に横スクロールする箱があれば、その中でのはみ出しは崩れではない（表やコードブロック）
  const insideScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
    }
    return false;
  };
  const sticksOut = (r) => r.right > vw + 1 || r.left < -1;
  // 全部が画面の外にあるもの（閉じたドロワーなど）は数えない
  const offscreen = (r) => r.right <= 0 || r.left >= vw;

  const overflowing = [];
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;

    if (sticksOut(r) && !offscreen(r) && !insideScroller(el)) {
      const parent = el.parentElement;
      // 親もはみ出していれば親を原因として数える（いちばん外側だけ残す）
      if (!parent || !sticksOut(parent.getBoundingClientRect())) {
        overflowing.push({ el: describe(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
      }
    }

    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText && (cs.overflow === "hidden" || cs.overflowX === "hidden") && cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1) {
      clipped.push({ el: describe(el), visibleWidth: el.clientWidth, textWidth: el.scrollWidth });
    }
  }

  const interactive = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"]';
  const smallTargets = [];
  const unnamed = [];
  for (const el of document.querySelectorAll(interactive)) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || offscreen(r) || el.disabled) continue;
    // 文中のリンクは WCAG 2.5.8 の対象外
    const inlineText = el.tagName === "A" && getComputedStyle(el).display === "inline" && (el.parentElement?.innerText || "").trim().length > (el.innerText || "").trim().length;
    if (!inlineText && (r.width < 24 || r.height < 24)) {
      smallTargets.push({ el: describe(el), width: Math.round(r.width), height: Math.round(r.height) });
    }
    const name = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el.innerText || "").trim() || el.getAttribute("placeholder") || (el.labels && el.labels.length ? "label" : "");
    // 名前の無いボタン・入力欄（アイコンだけのボタンなど）は、読み上げで何のボタンかわからない
    if (!name) unnamed.push(describe(el));
  }

  const smallInputs = [];
  for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, [contenteditable="true"]')) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) smallInputs.push({ el: describe(el), fontSize: size });
  }

  return JSON.stringify(
    {
      url: location.href,
      innerWidth: window.innerWidth,
      clientWidth: vw,
      zoom: Math.round(window.devicePixelRatio * 100) / 100,
      scrollWidth: doc.scrollWidth,
      horizontalOverflow: doc.scrollWidth > vw + 1,
      overflowing: overflowing.slice(0, LIMIT),
      clipped: clipped.slice(0, LIMIT),
      smallTargets: smallTargets.slice(0, LIMIT),
      smallInputs: smallInputs.slice(0, LIMIT),
      unnamed: unnamed.slice(0, LIMIT),
      counts: { overflowing: overflowing.length, clipped: clipped.length, smallTargets: smallTargets.length, smallInputs: smallInputs.length, unnamed: unnamed.length },
    },
    null,
    1,
  );
})();
