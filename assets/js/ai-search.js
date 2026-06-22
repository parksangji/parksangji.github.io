// AI 시맨틱 검색 (클라이언트 전용, 키 없음).
// 빌드타임과 동일한 로컬 모델(Xenova/multilingual-e5-small, q8)로 쿼리를 임베딩해
// 정적 인덱스(search-index.json)와 코사인 유사도로 의미 기반 검색한다.
// 모델은 처음 검색할 때만 lazy 로드(진행바) → 브라우저 캐시에 저장돼 다음부터 즉시.
import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const MODEL_ID = "Xenova/multilingual-e5-small";
const DTYPE = "q8";

env.allowLocalModels = false; // 모델은 HF 허브에서 받음
env.backends.onnx.wasm.proxy = true; // 무거운 연산을 워커로 → UI 안 멈춤

const root = document.getElementById("ai-search");
const indexUrl = root.dataset.index;
const form = document.getElementById("ai-search-form");
const input = document.getElementById("ai-search-input");
const statusEl = document.getElementById("ai-search-status");
const barWrap = document.getElementById("ai-search-progress");
const bar = document.getElementById("ai-search-bar");
const resultsEl = document.getElementById("ai-search-results");

let extractorPromise = null;
let indexPromise = null;

const setStatus = (msg) => { statusEl.textContent = msg || ""; };
const setProgress = (pct) => {
  if (pct == null) { barWrap.hidden = true; return; }
  barWrap.hidden = false;
  bar.style.width = `${Math.min(100, Math.round(pct))}%`;
};

function loadModel() {
  if (extractorPromise) return extractorPromise;
  const fileProgress = {};
  extractorPromise = pipeline("feature-extraction", MODEL_ID, {
    dtype: DTYPE,
    progress_callback: (p) => {
      if (p.status === "progress" && p.file) {
        fileProgress[p.file] = p.progress || 0;
        const vals = Object.values(fileProgress);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        setStatus("검색 모델 다운로드 중… (최초 1회, 이후 캐시)");
        setProgress(avg);
      } else if (p.status === "ready") {
        setProgress(null);
      }
    },
  });
  return extractorPromise;
}

function loadIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = fetch(indexUrl).then((r) => {
    if (!r.ok) throw new Error("인덱스 로드 실패");
    return r.json();
  });
  return indexPromise;
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function render(ranked, query) {
  if (!ranked.length) {
    resultsEl.innerHTML = `<p class="ai-empty">"${escapeHtml(query)}"에 대한 관련 글을 찾지 못했어요.</p>`;
    return;
  }
  resultsEl.innerHTML = ranked.map((r) => {
    const cats = (r.post.categories || []).join(" / ");
    const pct = Math.round(r.score * 100);
    return `
      <li class="ai-result">
        <a href="${r.post.url}">
          <div class="ai-result-head">
            <span class="ai-result-title">${escapeHtml(r.post.title)}</span>
            <span class="ai-result-score" title="의미 유사도">${pct}%</span>
          </div>
          <div class="ai-result-meta">${escapeHtml(cats)}${r.post.date ? " · " + r.post.date : ""}</div>
          <p class="ai-result-snippet">${escapeHtml(r.snippet)}</p>
        </a>
      </li>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

let busy = false;
async function search(query) {
  if (busy || !query.trim()) return;
  busy = true;
  resultsEl.innerHTML = "";
  try {
    setStatus("준비 중…");
    const [extractor, idx] = await Promise.all([loadModel(), loadIndex()]);
    setStatus("질의 분석 중…");
    const out = await extractor([`query: ${query}`], { pooling: "mean", normalize: true });
    const qv = out.data;

    // 청크 점수를 글 단위 최고점으로 집계
    const best = new Map();
    for (const c of idx.chunks) {
      const s = cosine(qv, c.v);
      const cur = best.get(c.p);
      if (!cur || s > cur.score) best.set(c.p, { score: s, snippet: c.t });
    }
    const ranked = [...best.entries()]
      .map(([p, v]) => ({ post: idx.posts[p], score: v.score, snippet: idx.posts[p].snippet || v.snippet }))
      .filter((r) => r.score > 0.78) // 약한 매칭 컷
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    setStatus(ranked.length ? `관련 글 ${ranked.length}개` : "");
    render(ranked, query);
  } catch (e) {
    console.error(e);
    setStatus("오류가 발생했어요. 새로고침 후 다시 시도해 주세요.");
  } finally {
    busy = false;
    setProgress(null);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  search(input.value);
});

// 예시 칩 클릭 → 즉시 검색
document.querySelectorAll(".ai-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    input.value = chip.textContent;
    search(input.value);
  });
});
