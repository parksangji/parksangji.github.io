// _posts/*.md → 임베딩 인덱스(assets/js/data/search-index.json) 생성.
// 키·외부 API 없음. 글 작성 후 재실행하거나 CI에서 jekyll 빌드 전에 실행.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { MODEL_ID, DIM, embed, asPassage, markdownToText, chunkText } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const POSTS_DIR = join(ROOT, "_posts");
const OUT_DIR = join(ROOT, "assets", "js", "data");
const OUT_FILE = join(OUT_DIR, "search-index.json");

// 파일명(YYYY-MM-DD-slug.md) → permalink. _config.yml: /posts/:title/  (:title=파일 slug)
function postUrl(filename) {
  const slug = basename(filename, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return `/posts/${slug}/`;
}

// 부동소수 6자리로 잘라 JSON 용량 절감(품질 영향 무시 가능)
const round = (v) => Math.round(v * 1e6) / 1e6;

function main() {
  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md")).sort();
  console.log(`글 ${files.length}편 처리 → 모델 ${MODEL_ID}`);

  const posts = [];
  const chunkRecords = []; // { p: postIdx, text }

  for (const file of files) {
    const raw = readFileSync(join(POSTS_DIR, file), "utf8");
    const { data: fm, content } = matter(raw);
    if (fm.published === false) continue;

    const title = (fm.title || basename(file, ".md")).toString();
    const text = markdownToText(content);
    const chunks = chunkText(text);
    const postIdx = posts.length;

    posts.push({
      id: basename(file, ".md"),
      title,
      url: postUrl(file),
      date: fm.date ? new Date(fm.date).toISOString().slice(0, 10) : null,
      categories: [].concat(fm.categories || []),
      tags: [].concat(fm.tags || []),
      series: fm.series || null,
      snippet: text.slice(0, 160).replace(/\s+/g, " ").trim(),
    });

    // 제목 + 카테고리/태그를 첫 청크에 합쳐 검색 신호 강화
    const head = [title, [].concat(fm.categories || []).join(" "), [].concat(fm.tags || []).join(" ")]
      .filter(Boolean).join(" — ");
    chunkRecords.push({ p: postIdx, text: `${head}. ${chunks[0] || ""}`.trim() });
    for (let i = 1; i < chunks.length; i++) chunkRecords.push({ p: postIdx, text: chunks[i] });
  }

  console.log(`청크 ${chunkRecords.length}개 임베딩 중...`);
  const BATCH = 16;
  const vectors = [];
  let done = 0;
  // 순차 배치(메모리 안정). 짧은 글이라 금방 끝남.
  const run = async () => {
    for (let i = 0; i < chunkRecords.length; i += BATCH) {
      const batch = chunkRecords.slice(i, i + BATCH).map((c) => asPassage(c.text));
      const embs = await embed(batch);
      for (const e of embs) vectors.push(Array.from(e, round));
      done += batch.length;
      process.stdout.write(`\r  ${done}/${chunkRecords.length}`);
    }
    process.stdout.write("\n");

    const chunks = chunkRecords.map((c, i) => ({
      p: c.p,
      t: c.text.slice(0, 140).replace(/\s+/g, " ").trim(), // 결과 스니펫/하이라이트용
      v: vectors[i],
    }));

    mkdirSync(OUT_DIR, { recursive: true });
    const payload = { model: MODEL_ID, dim: DIM, generatedAt: null, posts, chunks };
    writeFileSync(OUT_FILE, JSON.stringify(payload));
    const kb = (Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(0);
    console.log(`완료 → ${OUT_FILE} (${posts.length}글, ${chunks.length}청크, ${kb}KB)`);
  };
  return run();
}

main().catch((e) => { console.error(e); process.exit(1); });
