// 变异证据用的那两手：apply 改坏冻结夹具里的一个边号，restore 按字节还原。
//
// 为什么要改**夹具**而不是改引擎：浏览器那一腿（tools/scenarios.js 的 play / resume-set）
// 拿参考环的方式是「冻结的边号 → 屏幕中点 → 真指针事件」。如果页面其实是拿自己的引擎现算
// 一个环来对账（自己对自己），那改坏 golden.mjs 应该什么都不会发生——而那正是这条变异要排除的
// 那种假绿。所以这里换掉的是**边号本身**，而且换成同盘面上另一条合法边：题面指纹（clues）不会
// 变，只有"这条环是不是那条环"变了。
//
// apply 不写死任何数字：它从 g4a 那条记录里读出现在的边集，挑一个"盘面上存在但不在这条环里"
// 的边号做替换。夹具哪天被 write-golden.mjs 重生成，这里跟着走。
//
//   node tools/golden-mutate.mjs apply <备份路径>   # 备份原文 → 就地改坏 → 打印改了什么
//   node tools/golden-mutate.mjs restore <备份路径> # 还原 + 逐字节对账（对不上就非零退出）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'golden.mjs');
const SEED = 'g4a';

const must = (cond, msg) => {
  if (!cond) {
    console.error('MUTATION-ABORT ' + msg);
    process.exit(2);
  }
};

const edgesOf = (line) => {
  const m = /"edges":\[([0-9,]+)\]/.exec(line);
  must(m, `${SEED} 那条记录里没有 "edges":[...]，夹具格式变了`);
  return m;
};

function apply(backup) {
  const src = readFileSync(GOLDEN, 'utf8');
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.includes(`"seed":"${SEED}"`));
  must(i >= 0, `golden.mjs 里找不到 seed=${SEED} 的记录`);
  const line = lines[i];
  const m = edgesOf(line);
  const edges = m[1].split(',').map(Number);
  must(edges.length > 4, `${SEED} 的边集只有 ${edges.length} 条，不够做替换`);
  // E = 2wh+h+w（js/engine/grid.js 的同一口径）；挑一条"在网格上、但不在这条环里"的边号。
  const rec = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1).replace(/,\s*$/, ''));
  const E = 2 * rec.w * rec.h + rec.h + rec.w;
  const inLoop = new Set(edges);
  const swapIn = [...Array(E).keys()].find((e) => !inLoop.has(e));
  must(swapIn !== undefined, `${rec.w}×${rec.h} 的 ${E} 条边全在这条环里，没有可替换的边号`);
  const drop = edges[4];
  const out = line.replace(m[0], `"edges":[${edges.map((e) => (e === drop ? swapIn : e)).join(',')}]`);
  must(out !== line, '替换之后字符串一模一样 —— needle 没命中，不许把原文件当备份写出去');
  must(src.split(m[0]).length - 1 === 1, `"edges":[${m[1]}] 在文件里出现了不止一次，替换会误伤别的记录`);
  writeFileSync(backup, src);
  must(readFileSync(backup, 'utf8') === src, '备份读回来和原文不一致');
  writeFileSync(GOLDEN, src.split('\n').map((l, k) => (k === i ? out : l)).join('\n'));
  console.log(`MUTATED ${SEED} ${rec.w}×${rec.h} 边号 ${drop} → ${swapIn}（题面 clues 没动；备份在 ${path.basename(backup)}）`);
}

function restore(backup) {
  must(existsSync(backup), `备份 ${backup} 不存在——还原无从谈起，去 git status 看 golden.mjs 现在的样子`);
  const orig = readFileSync(backup, 'utf8');
  writeFileSync(GOLDEN, orig);
  must(readFileSync(GOLDEN, 'utf8') === orig, '还原之后字节对不上');
  console.log('RESTORED golden.mjs 逐字节回到原样');
}

const [cmd, backup] = process.argv.slice(2);
must(backup, '用法: node tools/golden-mutate.mjs apply|restore <备份路径>');
if (cmd === 'apply') apply(backup);
else if (cmd === 'restore') restore(backup);
else must(false, `未知子命令 ${cmd}（只有 apply / restore）`);
