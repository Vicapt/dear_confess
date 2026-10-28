// 全量核对：隐藏表格每一行 == 结果页正文 == .txt 镜像 == 题库
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "questions.json"), "utf8"));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// 结果页题面：h2.question 去掉行内标签后的纯文本（色号会带 <span> 样式）
function pageQuestion(page) {
  const m = page.match(/<h2[^>]*class="[^"]*\bquestion\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/);
  if (!m) return null;
  return m[1]
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const bank = { label: "题库", list: data.questions || [], cls: "ai-bank" };

let bad = 0;
{
  const m = html.match(new RegExp("<table class=\"" + bank.cls + "\">[\\s\\S]*?</table>"));
  if (!m) {
    console.log("BAD 找不到表格：" + bank.label);
    bad++;
  } else {
    const table = m[0];
    bank.list.forEach((q) => {
      const row = table.match(new RegExp('<tr id="row-' + q.id + '">([\\s\\S]*?)</tr>'));
      const page = fs.readFileSync(path.join(ROOT, "draw", q.id + ".html"), "utf8");
      const pageQ = pageQuestion(page);
      const txt = fs.readFileSync(path.join(ROOT, "draw", q.id + ".txt"), "utf8");
      const txtQ = txt.match(/题目：([\s\S]*)/);

      const problems = [];
      if (!row) problems.push("表格无此行");
      else if (!row[1].includes(q.text)) problems.push("表格题面不符");
      if (!pageQ) problems.push("结果页无 .question");
      else if (pageQ !== q.text) problems.push("结果页题面不符");
      if (!txtQ) problems.push("txt 无题目行");
      else if (txtQ[1].trim() !== q.text) problems.push("txt 题面不符");

      if (problems.length) {
        bad++;
        console.log("BAD " + q.id + ": " + problems.join(" / "));
      }
    });
  }
}

const total = bank.list.length;
// 按编号前缀分组报数（常驻题一组，每个节日各一组）
const groupCount = {};
bank.list.forEach((q) => {
  const k = q.season ? q.season : "常驻题";
  groupCount[k] = (groupCount[k] || 0) + 1;
});
const breakdown = Object.keys(groupCount)
  .map((k) => k + " " + groupCount[k] + " 道")
  .join("、");
console.log(
  "核对 " + total + " 题（" + breakdown + "）：",
  bad === 0 ? "表格 / 结果页 / txt / 题库 四者全部一致 ✓" : bad + " 处不一致"
);
process.exit(bad === 0 ? 0 : 1);
