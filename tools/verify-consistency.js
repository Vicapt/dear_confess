// 全量核对：隐藏表格每一行 == 结果页正文 == .txt 镜像 == 题库
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const list = JSON.parse(fs.readFileSync(path.join(ROOT, "questions.json"), "utf8")).questions;
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const table = html.match(/<table class="ai-bank">[\s\S]*?<\/table>/)[0];

let bad = 0;
list.forEach((q) => {
  const row = table.match(new RegExp('<tr id="row-' + q.id + '">([\\s\\S]*?)</tr>'));
  const page = fs.readFileSync(path.join(ROOT, "draw", q.id + ".html"), "utf8");
  const pageQ = page.match(/<p class="question">([^<]+)<\/p>/);
  const txt = fs.readFileSync(path.join(ROOT, "draw", q.id + ".txt"), "utf8");
  const txtQ = txt.match(/题目：([\s\S]*)/);

  const problems = [];
  if (!row) problems.push("表格无此行");
  else if (!row[1].includes(q.text)) problems.push("表格题面不符");
  if (!pageQ) problems.push("结果页无 .question");
  else if (pageQ[1] !== q.text) problems.push("结果页题面不符");
  if (!txtQ) problems.push("txt 无题目行");
  else if (txtQ[1].trim() !== q.text) problems.push("txt 题面不符");

  if (problems.length) {
    bad++;
    console.log("BAD " + q.id + ": " + problems.join(" / "));
  }
});

console.log(
  "核对 " + list.length + " 题：",
  bad === 0 ? "表格 / 结果页 / txt / 题库 四者全部一致 ✓" : bad + " 处不一致"
);
process.exit(bad === 0 ? 0 : 1);
