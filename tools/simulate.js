// 模拟一次完整的 AI 抽卡：读入口 -> 自主选题 -> 走第一梯队 -> 核对第二梯队是否一致
// 对线上站点跑（需要能访问外网）
const B = process.argv[2] || "https://cards.vicapt.top";

// 结果页题面：h2.question 去掉行内标签后的纯文本
// （题面里的色号会带 <span> 样式，读到的文字仍然逐字一致）
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

async function get(u) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(u);
      if (r.ok) return await r.text();
    } catch (e) {}
    await new Promise((s) => setTimeout(s, 3000));
  }
  throw new Error("fail " + u);
}

// 跑一组：prefix=q（问 AI 的题）
async function run(idx, prefix, count) {
  console.log("\n===== " + prefix + " 组 =====");
  const pick = prefix + String(Math.floor(Math.random() * count) + 1).padStart(2, "0");
  console.log("② 自主选题: " + pick);

  // 第一梯队：真的打开结果页
  const page = await get(B + "/draw/" + pick + ".html");
  const m = { 1: pageQuestion(page) };
  console.log("③ 第一梯队: 打开 /draw/" + pick + ".html -> " + m[1]);

  // 第二梯队：降级时只读表格里那一行
  const row = idx.match(new RegExp('<tr id="row-' + pick + '">([\\s\\S]*?)</tr>'));
  const cells = row[1]
    .replace(/<[^>]+>/g, "|")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log("④ 第二梯队: 表格第 " + cells[0] + " 行 -> " + cells[2]);
  console.log("   两个梯队题面一致:", cells[2] === m[1]);

  // 纯文本入口的同一道题
  const txt = await get(B + "/draw/" + pick + ".txt");
  const t = txt.match(/题目：([\s\S]*)/);
  console.log("⑤ .txt 镜像: " + t[1].trim());
  console.log("   与 html 一致:", t[1].trim() === m[1]);
}

(async () => {
  const idx = await get(B + "/index.html");
  console.log("① 入口 index.html: 读取成功");
  console.log("   读到第一梯队指令:", idx.includes("第一梯队"));
  console.log("   读到第二梯队指令:", idx.includes("第二梯队"));
  console.log("   读到只读单行要求:", idx.includes("只读取表格中该编号所在的那一行"));
  console.log("   读到交回话头由 AI 自己决定:", idx.includes("由你决定"));

  const manifest = JSON.parse(await get(B + "/index.json"));
  console.log("   index.json: q 组 " + manifest.count + " 道");

  await run(idx, "q", manifest.count);
})().catch((e) => console.log("ERR", e.message));
