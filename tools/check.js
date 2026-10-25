#!/usr/bin/env node
/**
 * 校验生成的静态页：
 *  - 每个 qNN.html 都存在，且正文里包含 questions.json 中对应的题目原文
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

const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const errors = [];

const firstId = list[0].id;
const lastId = list[list.length - 1].id;

// 从结果页 HTML 里取出题面：h2.question 去掉标签与实体后的纯文本。
// 题目里可能有 <span> 之类的行内标签（色号会加等宽样式），
// 比对时要按「人能读到的文字」来比，而不是按标记比。
function questionText(html) {
  const m = html.match(/<h2[^>]*class="[^"]*\bquestion\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/);
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

if (!list.length) errors.push("questions.json 里没有「问 AI 的题」");

if (!indexHtml.includes(firstId) || !indexHtml.includes(lastId)) {
  errors.push("index.html 未包含题号范围 " + firstId + "-" + lastId);
}
// 题号范围必须由题库动态生成，不能写死（题库增减后会悄悄失效）
if (!indexHtml.includes(firstId + "–" + lastId)) {
  errors.push("index.html 未使用当前题号范围 " + firstId + "–" + lastId + "（疑似写死）");
}
// 人看到的题目总数必须和题库一致。
// 只锚「共 N 道」这半句，前面的措辞（题库共 / 全站共）允许随文案改。
if (!indexHtml.includes("共 " + list.length + " 道")) {
  errors.push("index.html 的题库总数与题库不一致（应为 " + list.length + "）");
}
if (!indexHtml.includes("/draw/")) {
  errors.push("index.html 未包含结果链接格式说明");
}

// 已废弃的 u 组（问用户的题）必须彻底消失
if (/\bu\d\d\b/.test(indexHtml)) {
  errors.push("index.html 仍残留 u 组编号（u 组题库已废弃）");
}
if (fs.existsSync(path.join(ROOT, "play.html"))) {
  errors.push("play.html 仍存在（u 组选号页已废弃）");
}
if (fs.existsSync(path.join(ROOT, "src", "play.template.html"))) {
  errors.push("src/play.template.html 仍存在（u 组选号页已废弃）");
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

// ai.txt 里必须有可按行取题的隐藏题库
{
  const aiTxt = fs.readFileSync(path.join(ROOT, "ai.txt"), "utf8");
  const rows = aiTxt.match(/^第 \d+ 行｜q\d\d｜.+$/gm) || [];
  if (rows.length !== list.length) {
    errors.push(`ai.txt 的隐藏题库行数为 ${rows.length}，应为 ${list.length}`);
  }
  list.forEach((q, i) => {
    const expected = `第 ${i + 1} 行｜${q.id}｜${q.text}`;
    if (!aiTxt.includes(expected)) {
      errors.push(`ai.txt 的隐藏题库缺少「${q.id}」这一行`);
    }
  });
  if (/第 \d+ 行｜u\d\d｜/.test(aiTxt)) {
    errors.push("ai.txt 仍残留 u 组隐藏题库（u 组题库已废弃）");
  }
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
    if (manifest.userCount !== undefined || manifest.userItems !== undefined) {
      errors.push("index.json 仍包含 u 组字段（u 组题库已废弃）");
    }
    const items = manifest.items;
    if (!items || items.length !== list.length) {
      errors.push("index.json 的 items 数量与题目数不一致");
    } else {
      list.forEach((q, i) => {
        const it = items[i];
        if (it.id !== q.id) {
          errors.push(`index.json items 第 ${i + 1} 项 id 不对：期望 ${q.id}，实际 ${it.id}`);
        }
        if (!it.html || !it.html.includes("/draw/" + q.id + ".html")) {
          errors.push(`index.json 中 ${q.id} 的 html 路径不正确`);
        }
        if (!it.txt || !it.txt.includes("/draw/" + q.id + ".txt")) {
          errors.push(`index.json 中 ${q.id} 的 txt 路径不正确`);
        }
      });
    }
    // 清单不含题面：保证 AI 仍必须实际打开结果页读题
    const manifestRaw = fs.readFileSync(indexJsonPath, "utf8");
    list.forEach((q) => {
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

// 隐藏题库表格：每行一个编号与锚点，题目在表格单元格里
{
  const tableMatch = indexHtml.match(/<table class="ai-bank">[\s\S]*?<\/table>/);
  if (!tableMatch) {
    errors.push("初始页缺少隐藏题库表格（降级路径）");
  }
  if (/<table class="ai-bank ai-bank-user">/.test(indexHtml)) {
    errors.push("初始页仍保留 u 组隐藏题库表格（u 组题库已废弃）");
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
      const pageQ = questionText(pageHtml);
      if (!pageQ) {
        errors.push(q.id + ".html 缺少 .question 题面");
        return;
      }
      if (pageQ !== q.text) {
        errors.push(q.id + ".html 的题面与题库不一致");
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
// 复制按钮复制出去的必须是「一句邀请 + 链接」，不能是裸链接。
// 裸链接扔给 AI，它多半当成一份「待分析的资料」；前缀一句「来抽一题真心话」，
// 对方才知道这是要它陪你玩。
//
// 注意：这里必须断言**复制按钮的实际赋值**，不能断言「整页里出现过这句话」——
// 「来抽一题真心话」这六个字在指令正文里也出现（用来解释它该怎么理解），
// 所以整页 includes 是空断言：把复制按钮改回裸链接，它照样通过。
const copyTextMatch = indexHtml.match(/var\s+COPY_TEXT\s*=\s*([^;]+);/);
if (!copyTextMatch) {
  errors.push("初始页的脚本里找不到 COPY_TEXT（复制出去的内容没有写死）");
} else if (!/^"来抽一题真心话\\n"\s*\+\s*SITE_URL$/.test(copyTextMatch[1].trim())) {
  errors.push(
    "初始页的复制按钮复制出去的不是「来抽一题真心话 + 链接」，实际是：" +
      copyTextMatch[1].trim()
  );
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
// 答完之后要不要把话头交回给用户：交由 AI 自己决定，指令必须说清「由你决定」
if (!indexHtml.includes("由你决定")) {
  errors.push("初始页指令没有说明「要不要把话头交回给用户由 AI 自己决定」");
}
if (!indexHtml.includes("不要替用户回答")) {
  errors.push("初始页指令没有要求 AI 交回话头时不替用户回答");
}
// 人称必须写死：题面里的「对方」就是当前用户本人，否则 AI 会当成第三方
if (!indexHtml.includes("指的就是你此刻正在对话的这个用户本人")) {
  errors.push("初始页指令没有写明「对方」指的是当前用户本人");
}
if (!indexHtml.includes("回答时直接用「你」对他说")) {
  errors.push("初始页指令没有要求 AI 用第二人称回答（不要写成「他」）");
}
// 有些平台（豆包）拿到陌生链接的第一反应是「把这个网页分析一遍」，
// 于是把整页内容复述一遍、把站点分析一番 —— 而不是开局抽卡。
// 指令必须写死三件事：这是游戏不是任务、除非用户问起否则不许介绍网页、
// 实在拿不准时可以问一句「要不要玩一局？」。
//
// 关键：要**逐层**断言，不是「整页里出现过一次就算过」。
// 不同平台读到的层完全不同 —— 有的只读 meta，有的只读 HTML 注释，
// 有的取 DOM 文本，有的只认 <html> 上的属性。
// 约束只写在一层，就等于只对读那一层的平台有效。
function extractLayers(html) {
  return {
    "HTML 注释": (html.match(/<!--\s*\n([\s\S]*?)\n\s*-->/) || [, ""])[1],
    'meta ai-instruction':
      (html.match(/<meta[^>]*name="ai-instruction"[^>]*content="([^"]*)"/) || [, ""])[1],
    "隐藏 DOM 指令块":
      (html.match(/<div hidden[^>]*class="ai-directive"[^>]*>([\s\S]*?)<\/div>/) || [, ""])[1],
    "data-ai-task 属性": (html.match(/data-ai-task="([^"]*)"/) || [, ""])[1]
  };
}

// 初始页每层都必须带的三个约束
const INDEX_RULES = [
  ["这是一个游戏，不是一个任务", "「这是游戏不是任务」的定性"],
  ["不要向用户介绍", "「不要向用户介绍网页本身」"],
  ["要不要玩一局？", "「拿不准时可以问一句要不要玩一局」"]
];
const indexLayers = extractLayers(indexHtml);
Object.entries(indexLayers).forEach(([label, text]) => {
  INDEX_RULES.forEach(([needle, what]) => {
    if (!text.includes(needle)) {
      errors.push("初始页的「" + label + "」层缺少" + what + "的约束");
    }
  });
});
// 纯文本入口同理（抓取器常常只读这些文件）
[
  ["ai.txt", "ai.txt"],
  ["llms.txt", "llms.txt"],
  ["robots.txt", "robots.txt"]
].forEach(([file, label]) => {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  INDEX_RULES.forEach(([needle, what]) => {
    if (!text.includes(needle)) {
      errors.push(label + " 缺少" + what + "的约束");
    }
  });
});

// 「来抽一题真心话 + 链接」这句话必须被明确解释成「请你开局抽卡」，
// 否则 AI 可能把它误读成「反过来问我一道题」（指令里的「重要三」），
// 于是礼貌地反问用户一句，什么也没抽到。
// 这句话同样要**逐层**出现：只写在一层，就只对读那一层的平台有效。
Object.entries(indexLayers).forEach(([label, text]) => {
  if (!text.includes("那是在请你开局抽卡")) {
    errors.push("初始页的「" + label + "」层没有说明「来抽一题真心话 + 链接」是在请你开局抽卡");
  }
});
if (!fs.readFileSync(path.join(ROOT, "ai.txt"), "utf8").includes("那是在请你开局抽卡")) {
  errors.push("ai.txt 没有说明「来抽一题真心话 + 链接」是在请你开局抽卡");
}

// 读不到时，必须提示用户开启「深度思考」/联网模式后再试（平台能力是「平台 × 模式」的函数）
if (!indexHtml.includes("深度思考")) {
  errors.push("初始页缺少「开启深度思考后重试」的引导");
}
if (!fs.readFileSync(path.join(ROOT, "ai.txt"), "utf8").includes("深度思考")) {
  errors.push("ai.txt 缺少「开启深度思考后重试」的引导");
}
// 候选链接清单：只有地址，没有题面
const linkMatches = indexHtml.match(/href="draw\/q\d\d\.html"/g) || [];
if (linkMatches.length < list.length) {
  errors.push(
    "初始页候选结果页链接不足（实得 " + linkMatches.length + "，应为 " + list.length + "）"
  );
}
if (/\bexample\.com\b/.test(indexHtml)) {
  errors.push("index.html 仍残留 example.com 占位域名");
}

const seenTexts = new Map();
list.forEach((q) => {
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

  const directive = html.split('class="ai-directive"')[1] || "";
  if (!/回答这道题|回答它/.test(directive)) {
    errors.push(q.id + ".html 的指令没有要求 AI 回答这道题");
  }
  if (!directive.includes("指的就是当前这个用户本人")) {
    errors.push(q.id + ".html 的指令没有写明题面里的「对方」指当前用户本人");
  }
  // 结果页长得像一张票据，很容易诱使 AI 去点评外观而不是回答题目。
  // 同样要逐层断言：结果页有 4 层 AI 埋点（注释 / meta / 隐藏块 / data-ai-task）。
  const pageLayers = extractLayers(html);
  [
    ["这是一个游戏，不是一个任务", "「这是游戏不是任务」的定性"],
    ["不要介绍、描述或分析这个页面的样子", "「不要点评这个页面外观」"]
  ].forEach(([needle, what]) => {
    Object.entries(pageLayers).forEach(([label, text]) => {
      if (!text.includes(needle)) {
        errors.push(q.id + ".html 的「" + label + "」层缺少" + what + "的约束");
      }
    });
  });

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

  // 题目正文必须直接写在 HTML 里（不是 JS 变量拼出来的）。
  // 页面里确实有一个 <script>（复制按钮用），所以这里看的是「去掉脚本后的正文」里有没有题面。
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  if (!questionText(noScript)) {
    errors.push(q.id + ".html 的题面似乎只在脚本中生成");
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

const files = fs
  .readdirSync(path.join(ROOT, "draw"))
  .filter((f) => f.endsWith(".html"));
if (files.length !== list.length) {
  errors.push(
    `draw/ 目录页面数 ${files.length} 与题目数（${list.length}）不一致`
  );
}
const strayFiles = fs.readdirSync(path.join(ROOT, "draw"));
if (strayFiles.some((f) => /^u\d\d\./.test(f))) {
  errors.push("draw/ 目录仍残留 u 组结果页");
}

// 本地预览服务器的 MIME 表必须和线上（GitHub Pages）一致。
// 不一致的话本地预览会在某个维度上骗人：比如 .txt 兜底成 octet-stream 后，
// 浏览器会当二进制触发下载，而不是显示纯文本。
{
  const serveSrc = fs.readFileSync(path.join(ROOT, "tools", "serve.js"), "utf8");
  const block = serveSrc.match(/const TYPES = \{([\s\S]*?)\n\};/);
  if (!block) {
    errors.push("tools/serve.js 里找不到 TYPES 表");
  } else {
    const mapped = new Set(
      [...block[1].matchAll(/"(\.[a-z0-9]+)":\s*"([^"]+)"/gi)].map((m) => m[1])
    );
    // .txt 是给 AI 的纯文本镜像路径，.xml 是站点地图，都必须是正规 MIME
    [
      [".txt", "text/plain"],
      [".xml", "application/xml"]
    ].forEach(([ext, mime]) => {
      if (!mapped.has(ext)) {
        errors.push(`tools/serve.js 的 TYPES 表缺少 ${ext}（应为 ${mime}）`);
        return;
      }
      const line = block[1].match(new RegExp('"' + ext + '":\\s*"([^"]+)"'));
      if (line && !line[1].startsWith(mime)) {
        errors.push(
          `tools/serve.js 里 ${ext} 的 MIME 是 ${line[1]}，与线上的 ${mime} 不一致`
        );
      }
    });
  }
}

if (errors.length) {
  console.error("校验失败：");
  errors.forEach((e) => console.error(" - " + e));
  process.exit(1);
}

console.log(
  `校验通过：${list.length} 个「问 AI 的题」结果页，编号与题目一一对应且互不重复。`
);
console.log(`题号范围：${firstId} - ${lastId}`);
