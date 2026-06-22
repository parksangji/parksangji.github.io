// 빌드타임/테스트 공용 임베딩 유틸. 외부 API·키 없음 — 전부 로컬 모델.
import { pipeline, env } from "@huggingface/transformers";

// 브라우저(ai-search.js)와 반드시 동일해야 함: 같은 모델·같은 양자화여야 임베딩 공간이 일치한다.
export const MODEL_ID = "Xenova/multilingual-e5-small";
export const DTYPE = "q8"; // 양자화(int8) — 브라우저 다운로드 용량과 빌드 일관성을 위해 동일 적용
export const DIM = 384;

// 다운로드 모델 캐시를 도구 폴더 안에 둔다(레포 .gitignore의 node_modules와 분리, 재실행 시 재사용).
env.cacheDir = new URL("./.model-cache/", import.meta.url).pathname;

let _extractor = null;
export async function getExtractor() {
  if (!_extractor) {
    _extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE });
  }
  return _extractor;
}

// e5 계열은 passage/query 프리픽스를 요구한다.
export const asPassage = (t) => `passage: ${t}`;
export const asQuery = (t) => `query: ${t}`;

// 텍스트 배열 → 정규화된 mean-pooled 임베딩(Float32Array[]) 반환
export async function embed(texts) {
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const n = texts.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(out.data.slice(i * DIM, (i + 1) * DIM));
  }
  return result;
}

// 마크다운 본문 → 검색용 평문. 코드/이미지/링크 마크업 제거, 내용은 보존.
export function markdownToText(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")        // 코드블록 제거
    .replace(/`([^`]+)`/g, "$1")             // 인라인 코드 → 텍스트
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")   // 이미지 제거
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // 링크 → 텍스트만
    .replace(/^>+\s?/gm, "")                  // 인용 부호
    .replace(/^#{1,6}\s+/gm, "")              // 헤딩 # 제거(텍스트는 유지)
    .replace(/[*_~]{1,3}/g, "")               // 강조 기호
    .replace(/\{:[^}]*\}/g, " ")              // Chirpy 속성 {: .prompt-tip }
    .replace(/<[^>]+>/g, " ")                 // 잔여 HTML
    .replace(/\|/g, " ")                      // 표 구분자
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// 평문 → 청크. 단락 경계 우선, 청크당 대략 maxWords 단어. (글이 짧아 보통 1~2개)
export function chunkText(text, maxWords = 220) {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = [];
  let count = 0;
  const flush = () => {
    if (buf.length) { chunks.push(buf.join(" ").trim()); buf = []; count = 0; }
  };
  for (const p of paras) {
    const w = p.split(/\s+/).length;
    if (count + w > maxWords && count > 0) flush();
    buf.push(p);
    count += w;
  }
  flush();
  return chunks.length ? chunks : [text].filter(Boolean);
}

// 코사인 유사도(둘 다 정규화돼 있으면 내적과 동일)
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
