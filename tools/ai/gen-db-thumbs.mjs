import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const POSTS = '/Users/sangjipark/qrcode/blog/_posts';
const IMG = '/Users/sangjipark/qrcode/blog/assets/img/posts';

// slug(파일 베이스, 날짜 제외) → { eyebrow, title }
const DATA = [
  ['2023-01-12-db-why-dbms', '기초', '데이터베이스란 무엇인가'],
  ['2023-01-31-db-relational-model-normalization', '기초', '관계형 모델과 정규화'],
  ['2023-02-19-db-sql-execution-pipeline', '기초', 'SQL이 실행되는 길'],
  ['2023-03-10-db-storage-pages-heap-row', '저장 구조', '페이지·힙·로우 저장 구조'],
  ['2023-03-29-db-btree-index', '인덱스', 'B-Tree 인덱스'],
  ['2023-04-17-db-index-advanced', '인덱스', '인덱스를 걸었는데 왜 안 타나'],
  ['2023-05-06-db-index-types-gin-gist-brin', '인덱스', 'GIN·GiST·BRIN 인덱스'],
  ['2023-05-25-db-transactions-acid', '트랜잭션', '트랜잭션과 ACID'],
  ['2023-06-13-db-isolation-levels-anomalies', '동시성', '격리 수준과 이상현상'],
  ['2023-07-02-db-mvcc-internals', '동시성', 'MVCC 내부 동작'],
  ['2023-07-21-db-locking-deadlock', '동시성', '락 · 2PL · 데드락'],
  ['2023-08-09-db-wal-crash-recovery', '복구', 'WAL과 크래시 복구'],
  ['2023-08-28-db-explain-join-algorithms', '최적화', 'EXPLAIN과 조인 알고리즘'],
  ['2023-09-16-db-cardinality-statistics', '최적화', '카디널리티 추정과 통계'],
  ['2023-10-05-db-replication', '분산', '복제 (Replication)'],
  ['2023-10-24-db-partitioning-sharding', '분산', '파티셔닝과 샤딩'],
  ['2023-11-12-db-distributed-cap-consensus', '분산', '분산 트랜잭션 · CAP · 합의'],
  ['2023-12-01-db-nosql-landscape', 'NoSQL', 'NoSQL 지도와 LSM 트리'],
  ['2023-12-20-db-caching-consistency', '운영', '캐싱과 일관성'],
  ['2024-01-08-db-operations-modern', '운영', '운영의 기술과 현대 DB'],
];

const FONT = "'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif";

// 글자폭 추정으로 줄바꿈 (CJK≈0.98em, 라틴≈0.56em, 공백 0.32em)
function charW(ch, fs) {
  if (/[ᄀ-ᇿ가-힯　-ヿ一-鿿]/.test(ch)) return fs * 0.98;
  if (ch === ' ') return fs * 0.32;
  if (/[·\-—]/.test(ch)) return fs * 0.5;
  return fs * 0.56;
}
function wrap(text, fs, maxW) {
  const words = text.split(' ');
  const lines = []; let cur = '';
  const width = s => [...s].reduce((a, c) => a + charW(c, fs), 0);
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (width(trial) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = trial;
  }
  if (cur) lines.push(cur);
  // 한 단어가 너무 길면 글자단위로 쪼갬
  const out = [];
  for (const ln of lines) {
    if (width(ln) <= maxW) { out.push(ln); continue; }
    let seg = '';
    for (const c of ln) {
      if (width(seg + c) > maxW && seg) { out.push(seg); seg = c; } else seg += c;
    }
    if (seg) out.push(seg);
  }
  return out;
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildSVG(eyebrow, title) {
  const maxW = 760;
  let fs = 62;
  let lines = wrap(title, fs, maxW);
  if (lines.length > 2) { fs = 54; lines = wrap(title, fs, maxW); }
  if (lines.length > 3) { fs = 48; lines = wrap(title, fs, maxW); lines = lines.slice(0, 3); }
  const lh = fs * 1.18;
  const blockH = lines.length * lh;
  let y0 = 300 - blockH / 2 + fs; // 세로 중앙 정렬(타이틀 영역 중심 ~300)
  const tspans = lines.map((ln, i) =>
    `<tspan x="90" y="${Math.round(y0 + i * lh)}">${esc(ln)}</tspan>`).join('');

  // DB 실린더 로고 (흰 박스 안, PostgreSQL 블루)
  const cx = 1015, rx = 78, ry = 24, top = 222, bot = 382;
  const logo = `
    <g>
      <path d="M${cx - rx},${top} V${bot} A${rx},${ry} 0 0 0 ${cx + rx},${bot} V${top}" fill="#2f6690"/>
      <ellipse cx="${cx}" cy="${top}" rx="${rx}" ry="${ry}" fill="#3a7ca5"/>
      <path d="M${cx - rx},${top + 52} A${rx},${ry} 0 0 0 ${cx + rx},${top + 52}" fill="none" stroke="#dbeafe" stroke-width="3" opacity=".7"/>
      <path d="M${cx - rx},${top + 104} A${rx},${ry} 0 0 0 ${cx + rx},${top + 104}" fill="none" stroke="#dbeafe" stroke-width="3" opacity=".55"/>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f2436"/>
      <stop offset="100%" stop-color="#0e141b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="14" height="630" fill="#4f9cf9"/>
  <rect x="883" y="161" width="264" height="288" rx="28" fill="#ffffff"/>
  ${logo}
  <text x="90" y="150" font-family="${FONT}" font-size="26" font-weight="700" letter-spacing="3" fill="#7cc4ff">DATABASE · ${esc(eyebrow)}</text>
  <text font-family="${FONT}" font-size="${fs}" font-weight="800" fill="#f2f3f4">${tspans}</text>
  <text x="90" y="560" font-family="${FONT}" font-size="28" font-weight="500" fill="#8b96a0">쿠오 · Kuo의 삶을 담은 블로그</text>
</svg>`;
}

const ONLY = process.argv[2]; // 슬러그 일부로 1장만 테스트

for (const [slug, eyebrow, title] of DATA) {
  if (ONLY && !slug.includes(ONLY)) continue;
  const svg = buildSVG(eyebrow, title);
  const base = slug.replace(/^\d{4}-\d{2}-\d{2}-/, ''); // 날짜 제거 → db-*.png
  writeFileSync(`${IMG}/${base}.svg`, svg);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(`${IMG}/${base}.png`, png);
  const lqipBuf = await sharp(png).resize(24).jpeg({ quality: 40 }).toBuffer();
  const lqip = 'data:image/jpeg;base64,' + lqipBuf.toString('base64');

  // frontmatter 주입
  const fp = `${POSTS}/${slug}.md`;
  let md = readFileSync(fp, 'utf8');
  if (md.includes('\nimage:')) { console.log('skip(image exists):', slug); continue; }
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) { console.log('NO FRONTMATTER:', slug); continue; }
  let fm = m[1];
  const imgBlock = `image:\n  path: /assets/img/posts/${base}.png\n  lqip: "${lqip}"\n  alt: ${title}`;
  fm = fm + '\n' + imgBlock;
  md = md.replace(m[0], `---\n${fm}\n---\n`);
  writeFileSync(fp, md);
  console.log('done:', base, `(title lines, fs)`);
}
console.log('ALL DONE');
