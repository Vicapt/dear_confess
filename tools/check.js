#!/usr/bin/env node
/**
 * 校验生成的静态页：
 *  - 每个 qNN.html / uNN.html 都存在，且正文里包含 questions.json 中对应的题目原文
 *  - 题目编号与文件一一对应，无重复、无遗漏
 *  - index.html 里包含初始链接与题号范围
 *  - 反泄漏：description / og:description 不得含指令正文，指令块必须排在可见正文之后
 *
 * 用法：node tools/check.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const data = JSON.parse(
  fs.readFileSync(path.join(ROOT, "questions.json"), "utf8")
);
const list = data.questions || [];
const userList = data.userQuestions || [];

const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const errors = [];

const firstId = list[0].id;
const lastId = list[list.length - 1].id;
const userFirstId = userList[0].id;
const userLastId = userList[userList.length - 1].id;

if (!list.length) errors.push("questions.json 里没有「问 AI 的题」");
if (!userList.length) errors.push("questions.json 里没有「问用户的题」");

if (!indexHtml.includes(firstId) || !indexHtml.includes(lastId)) {
  errors.push("index.html 未包含题号范围 " + firstId + "-" + lastId);
}
// 题号范围必须由题库动态生成，不能写死（题库增减后会悄悄失效）
if (!indexHtml.includes(firstId + "–" + lastId)) {
  errors.push("index.html 未使用当前题号范围 " + firstId + "–" + lastId + "（疑似写死）");
}
if (!indexHtml.includes(userFirstId + "–" + userLastId)) {
  errors.push("index.html 未使用 u 组题号范围 " + userFirstId + "–" + userLastId + "（疑似写死）");
}
if (!indexHtml.includes("题库共 " + list.length + " 道")) {
  errors.push("index.html 的题库总数与题库不一致（应为 " + list.length + "）");
}
if (!indexHtml.includes(userList.length + " 道「问用户的题」")) {
  errors.push(
    "index.html 的 u 组题库总数与题库不一致（应为 " + userList.length + " 道「问用户的题」）"
  );
}
if (!indexHtml.includes("/draw/")) {
  errors.push("index.html 未包含结果链接格式说明");
}

// 初始页必须同时具备多种「AI 指令埋点」，否则 AI 打开后不会自行抽卡
const LAYERS = [
  ["HTML 注释", "<!--"],
  ['meta name="ai-instruction"', 'name="ai-instruction"'],
  ["meta description", 'name="description"'],
  ["og:description", 'property="og:description"'],
  ["隐藏 DOM 指令块", 'class="ai-directive"'],
  ["data-ai-task 属性", "data-ai-task"]
];
LAYERS.forEach(([label, needle]) => {
  if (!indexHtml.includes(needle)) {
    errors.push("index.html 缺少 AI 指令埋点：" + label);
  }
});

// 反泄漏：聊天软件（QQ / 微信）的链接卡片会把 description / og:description
// 当摘要直接显示给人类，也有的会取正文纯文本的前若干字符。
// 所以这两个字段里绝不能出现指令正文，指令块也必须排在可见正文之后。
function metaContent(name) {
  const re = new RegExp('<meta[^>]*' + name + '[^>]*content="([^"]*)"');
  const m = indexHtml.match(re);
  return m ? m[1] : "";
}
["name=\"description\"", "property=\"og:description\""].forEach((attr) => {
  const content = metaContent(attr);
  if (!content) {
    errors.push("index.html 缺少 " + attr + " 的 content");
  }
  if (/AI 指令|请自行选择|降级路径|不要询问用户/.test(content)) {
    errors.push(
      "index.html 的 " + attr + " 含 AI 指令正文，会在 QQ/微信链接卡片里暴露给人类"
    );
  }
});
// 指令仍必须留在非标准 meta 里，供保留 meta 的抓取器读取
if (!/AI 指令/.test(metaContent("name=\"ai-instruction\""))) {
  errors.push("index.html 的 ai-instruction meta 里没有指令正文");
}
// 隐藏指令块必须排在可见正文之后
const visibleEnd = indexHtml.indexOf("</section>");
const directiveAt = indexHtml.indexOf('class="ai-directive"');
if (directiveAt < 0) {
  errors.push("index.html 缺少隐藏指令块");
} else if (visibleEnd > 0 && directiveAt < visibleEnd) {
  errors.push("index.html 的隐藏指令块排在可见正文之前，会被链接卡片取作摘要");
}

// 纯文本入口
["ai.txt", "llms.txt", "robots.txt"].forEach((f) => {
  if (!fs.existsSync(path.join(ROOT, f))) {
    errors.push("缺少 " + f);
  }
});

// ai.txt 里必须有可按行取题的隐藏题库（纯文本下没有 DOM 表格），两组都要有
{
  const aiTxt = fs.readFileSync(path.join(ROOT, "ai.txt"), "utf8");
  const checkBank = (bank, prefix) => {
    const rows = aiTxt.match(new RegExp("^第 \\d+ 行｜" + prefix + "\\d\\d｜.+$", "gm")) || [];
    if (rows.length !== bank.length) {
      errors.push(`ai.txt 的 ${prefix} 组隐藏题库行数为 ${rows.length}，应为 ${bank.length}`);
    }
    bank.forEach((q, i) => {
      const expected = `第 ${i + 1} 行｜${q.id}｜${q.text}`;
      if (!aiTxt.includes(expected)) {
        errors.push(`ai.txt 的隐藏题库缺少「${q.id}」这一行`);
      }
    });
  };
  checkBank(list, "q");
  checkBank(userList, "u");
}

// index.json：机器可读的目录索引
const indexJsonPath = path.join(ROOT, "index.json");
if (!fs.existsSync(indexJsonPath)) {
  errors.push("缺少 index.json（目录索引）");
} else {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(indexJsonPath, "utf8"));
  } catch (e) {
    errors.push("index.json 不是合法 JSON：" + e.message);
  }
  if (manifest) {
    if (manifest.count !== list.length) {
      errors.push(`index.json 的 count（${manifest.count}）与题目数（${list.length}）不一致`);
    }
    if (manifest.userCount !== userList.length) {
      errors.push(
        `index.json 的 userCount（${manifest.userCount}）与 u 组题目数（${userList.length}）不一致`
      );
    }
    const checkItems = (items, bank, label) => {
      if (!items || items.length !== bank.length) {
        errors.push(`index.json 的 ${label} 数量与题目数不一致`);
        return;
      }
      bank.forEach((q, i) => {
        const it = items[i];
        if (it.id !== q.id) {
          errors.push(`index.json ${label} 第 ${i + 1} 项 id 不对：期望 ${q.id}，实际 ${it.id}`);
        }
        if (!it.html || !it.html.includes("/draw/" + q.id + ".html")) {
          errors.push(`index.json 中 ${q.id} 的 html 路径不正确`);
        }
        if (!it.txt || !it.txt.includes("/draw/" + q.id + ".txt")) {
          errors.push(`index.json 中 ${q.id} 的 txt 路径不正确`);
        }
      });
    };
    checkItems(manifest.items, list, "items");
    checkItems(manifest.userItems, userList, "userItems");
    // 清单不含题面：保证 AI 仍必须实际打开结果页读题
    const manifestRaw = fs.readFileSync(indexJsonPath, "utf8");
    list.concat(userList).forEach((q) => {
      if (manifestRaw.includes(q.text)) {
        errors.push("index.json 不应包含题目正文（否则 AI 无需访问结果页）");
      }
    });
  }
}

// 初始页应当把 index.json 作为可选清单指出来
if (!indexHtml.includes("index.json")) {
  errors.push("初始页未提及 index.json（目录索引）");
}

// 抽卡页：纯前端实现（随机 + 自己选编号）
const playPath = path.join(ROOT, "play.html");
if (!fs.existsSync(playPath)) {
  errors.push("缺少 play.html（抽卡页）");
} else {
  const play = fs.readFileSync(playPath, "utf8");
  if (!play.includes("index.json")) {
    errors.push("play.html 未读取 index.json");
  }
  if (!play.includes("Math.random")) {
    errors.push("play.html 未实现随机选择");
  }
  if (!/draw\/"\s*\+\s*item\.id/.test(play)) {
    errors.push("play.html 未按编号加载对应的静态题目文件");
  }
  // 用户选号码的界面：必须有两组编号按钮
  if (!play.includes("num-btn")) {
    errors.push("play.html 缺少编号按钮（用户自己选号码的界面）");
  }
  if (!play.includes("userItems")) {
    errors.push("play.html 未读取 u 组题目（问用户的题）");
  }
  if (!play.includes("buildGrid")) {
    errors.push("play.html 未实现编号网格的渲染");
  }
}

// 隐藏题库表格：两组都要有、每行一个编号与锚点，题目在表格单元格里
{
  const tableMatch = indexHtml.match(/<table class="ai-bank">[\s\S]*?<\/table>/);
  if (!tableMatch) {
    errors.push("初始页缺少隐藏题库表格（降级路径）");
  }
  const userTableMatch = indexHtml.match(/<table class="ai-bank ai-bank-user">[\s\S]*?<\/table>/);
  if (!userTableMatch) {
    errors.push("初始页缺少 u 组隐藏题库表格（降级路径）");
  }
  const checkTable = (table, bank, prefix, label) => {
    if (!table) return;
    const rowMatches = table.match(new RegExp('<tr id="row-' + prefix + '\\d\\d">', "g")) || [];
    if (rowMatches.length !== bank.length) {
      errors.push(`${label}行数为 ${rowMatches.length}，应为 ${bank.length}`);
    }
    bank.forEach((q) => {
      if (!table.includes('id="row-' + q.id + '"')) {
        errors.push(label + "缺少 " + q.id + " 行的锚点");
      }
      if (!table.includes(q.text)) {
        errors.push(label + "缺少 " + q.id + " 的题目");
      }
    });
    // 表格必须有表头，说明「行号」语义，AI 才能先选序号再读行
    if (!table.includes("<th>行号</th>")) {
      errors.push(label + "缺少「行号」表头");
    }
    // 降级路径与结果页必须给同一道题，否则降级读到的题和真实抽卡结果对不上
    bank.forEach((q) => {
      const page = path.join(ROOT, "draw", q.id + ".html");
      if (!fs.existsSync(page)) return;
      const pageHtml = fs.readFileSync(page, "utf8");
      const m = pageHtml.match(/<p class="question">([\s\S]*?)<\/p>/);
      if (!m) {
        errors.push(q.id + ".html 缺少 .question 题目段落");
        return;
      }
      if (m[1] !== q.text) {
        errors.push(q.id + ".html 的题目段落与题库不一致");
      }
      const row = table.match(
        new RegExp('<tr id="row-' + q.id + '">([\\s\\S]*?)</tr>')
      );
      if (row && !row[1].includes(q.text)) {
        errors.push(q.id + " 的隐藏表格行与题库不一致");
      }
    });
  };
  checkTable(tableMatch && tableMatch[0], list, "q", "q 组隐藏题库");
  checkTable(userTableMatch && userTableMatch[0], userList, "u", "u 组隐藏题库");
}

// 模拟常见抓取器：去掉 script/style/注释后取 DOM 文本，确认指令仍然读得到
function domText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

if (!domText(indexHtml).includes("请立即自行完成一次 AI 真心话扭蛋")) {
  errors.push("初始页的纯文本层读不到 AI 指令（隐藏指令块可能丢失）");
}
if (!domText(indexHtml).includes("/draw/q")) {
  errors.push("初始页的纯文本层读不到结果链接格式");
}
// 指令必须自带「以实际访问到的地址为准」的兜底，防止旧缓存里的占位域名误导 AI
if (!indexHtml.includes("一切以你实际访问到的地址为准")) {
  errors.push("初始页缺少「以你实际访问到的地址为准」的兜底说明");
}
// 指令必须包含五步自检要求
if (!indexHtml.includes("自检：完成后请逐项确认")) {
  errors.push("初始页缺少五步自检要求");
}
if (!indexHtml.includes("无法访问结果页")) {
  errors.push("初始页缺少「无法访问结果页」的失败声明要求");
}
// 必须提供多主机 / 多格式的等价读取路径（不同平台的抓取器限制差异很大）
if (!indexHtml.includes("qNN.txt")) {
  errors.push("初始页缺少纯文本备用路径");
}
// 降级路径必须要求「先选序号、再只读那一行」，避免一次性读完整份题库
if (!indexHtml.includes("只读取表格中该编号所在的那一行")) {
  errors.push("初始页缺少「先选序号再读单行」的降级路径要求");
}
if (!indexHtml.includes("不要一次性读完整张表")) {
  errors.push("初始页缺少「不要一次性读完整张表」的限制");
}
if (!indexHtml.includes("第一梯队")) {
  errors.push("初始页缺少第一梯队（真实抽卡）说明");
}
if (!indexHtml.includes("第二梯队")) {
  errors.push("初始页缺少第二梯队（降级）说明");
}
// 两套题库必须在指令里说清楚，AI 才知道 u 组是抛给用户的
if (!indexHtml.includes("问用户的题")) {
  errors.push("初始页指令未说明 u 组是「问用户的题」");
}
if (!indexHtml.includes("ai-bank-user")) {
  errors.push("初始页指令未提到 u 组隐藏表格");
}
// 答完之后必须主动邀请用户抽下一个（这是「一起玩」的关键动作）
if (!indexHtml.includes("主动邀请用户")) {
  errors.push("初始页指令缺少「回答后主动邀请用户抽一个」的要求");
}
if (!indexHtml.includes("play.html")) {
  errors.push("初始页指令未给出选号页地址（play.html）");
}
// 读不到时，必须提示用户开启「深度思考」/联网模式后再试（平台能力是「平台 × 模式」的函数）
if (!indexHtml.includes("深度思考")) {
  errors.push("初始页缺少「开启深度思考后重试」的引导");
}
if (!fs.readFileSync(path.join(ROOT, "ai.txt"), "utf8").includes("深度思考")) {
  errors.push("ai.txt 缺少「开启深度思考后重试」的引导");
}
// 候选链接清单：只有地址，没有题面
const linkMatches = indexHtml.match(/href="draw\/[qu]\d\d\.html"/g) || [];
if (linkMatches.length < list.length + userList.length) {
  errors.push(
    "初始页候选结果页链接不足（实得 " + linkMatches.length + "，应为 " +
      (list.length + userList.length) + "）"
  );
}
if (/\bexample\.com\b/.test(indexHtml)) {
  errors.push("index.html 仍残留 example.com 占位域名");
}

const seenTexts = new Map();
const checkBank = (bank, kind) => {
  bank.forEach((q) => {
    const file = path.join(ROOT, "draw", q.id + ".html");
    if (!fs.existsSync(file)) {
      errors.push("缺少结果页 " + q.id + ".html");
      return;
    }
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes(q.text)) {
      errors.push(q.id + ".html 正文未包含题目原文");
    }
    if (!html.includes(q.id)) {
      errors.push(q.id + ".html 未显示题目编号");
    }

    // q 组：AI 自己回答；u 组：把问题抛给用户
    const directive = html.split('class="ai-directive"')[1] || "";
    if (kind === "askUser") {
      if (!/问给用户|抛给用户|问用户/.test(directive)) {
        errors.push(q.id + ".html 的指令没有说明这道题要问给用户");
      }
      if (!/不要替用户回答|不要自己接话|等用户回答/.test(directive)) {
        errors.push(q.id + ".html 的指令没有要求 AI 等用户回答");
      }
    } else {
      if (!/回答这道题|回答它/.test(directive)) {
        errors.push(q.id + ".html 的指令没有要求 AI 回答这道题");
      }
    }

    // 纯文本镜像
    const txtFile = path.join(ROOT, "draw", q.id + ".txt");
    if (!fs.existsSync(txtFile)) {
      errors.push("缺少 " + q.id + ".txt（纯文本镜像）");
    } else {
      const txt = fs.readFileSync(txtFile, "utf8");
      if (!txt.includes(q.text)) {
        errors.push(q.id + ".txt 未包含题目原文");
      }
      // 解析约定：题目在「题目：」之后直到文末，机器可稳定取出
      const m = txt.match(/题目：([\s\S]*)/);
      if (!m || m[1].trim() !== q.text) {
        errors.push(q.id + ".txt 的题目不是文件最后一行（解析约定被破坏）");
      }
    }

    // 题目正文直接写在 HTML 里（不是 JS 变量），因此不应出现在 <script> 中
    const bodyScript = html.split("<script")[1];
    if (bodyScript && bodyScript.includes(q.text)) {
      errors.push(q.id + ".html 的题目似乎只在脚本中生成");
    }
    // 题目本身以「？」结尾，指令里不要再补句号（否则出现「？。」）
    if (html.includes(q.text + "。")) {
      errors.push(q.id + ".html 的指令里题目后多了一个句号（出现「？。」）");
    }
    if (seenTexts.has(q.text)) {
      errors.push(q.id + " 与 " + seenTexts.get(q.text) + " 题目重复");
    }
    seenTexts.set(q.text, q.id);
  });
};
checkBank(list, "askAI");
checkBank(userList, "askUser");

const files = fs
  .readdirSync(path.join(ROOT, "draw"))
  .filter((f) => f.endsWith(".html"));
if (files.length !== list.length + userList.length) {
  errors.push(
    `draw/ 目录页面数 ${files.length} 与题目数（${list.length}+${userList.length}）不一致`
  );
}

if (errors.length) {
  console.error("校验失败：");
  errors.forEach((e) => console.error(" - " + e));
  process.exit(1);
}

console.log(
  `校验通过：${list.length} 个「问 AI 的题」+ ${userList.length} 个「问用户的题」结果页，编号与题目一一对应且互不重复。`
);
console.log(`题号范围：${firstId} - ${lastId}（问 AI 的题） / ${userFirstId} - ${userLastId}（问用户的题）`);
