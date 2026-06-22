// 브라우저 없이 retrieval 품질을 검증한다: 인덱스 로드 → 질의 임베딩 → 상위 글 출력.
// 사용: node query-test.mjs "스프링 캐시 self-invocation 문제"
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { embed, asQuery, cosine } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "assets", "js", "data", "search-index.json");

const query = process.argv.slice(2).join(" ") || "레디스 캐시 어떻게 적용했어?";

async function main() {
  const idx = JSON.parse(readFileSync(INDEX, "utf8"));
  const [qv] = await embed([asQuery(query)]);

  // 청크 점수 → 글 단위로 최고점 집계
  const bestByPost = new Map();
  for (const c of idx.chunks) {
    const s = cosine(qv, c.v);
    const cur = bestByPost.get(c.p);
    if (!cur || s > cur.score) bestByPost.set(c.p, { score: s, snippet: c.t });
  }
  const ranked = [...bestByPost.entries()]
    .map(([p, v]) => ({ post: idx.posts[p], ...v }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  console.log(`\n질의: "${query}"\n`);
  ranked.forEach((r, i) => {
    console.log(`${i + 1}. [${r.score.toFixed(3)}] ${r.post.title}`);
    console.log(`   ${r.post.url}  (${(r.post.categories || []).join("/")})`);
    console.log(`   ${r.snippet}\n`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
