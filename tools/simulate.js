// 模拟一次完整的 AI 抽卡：读入口 -> 自主选题 -> 走第一梯队 -> 核对第二梯队是否一致
const B = process.argv[2] || "https://cards.vicapt.top";

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

(async () => {
  const idx = await get(B + "/index.html");
  console.log("① 入口 index.html: 读取成功");
  console.log("   读到第一梯队指令:", idx.includes("第一梯队"));
  console.log("   读到第二梯队指令:", idx.includes("第二梯队"));
  console.log("   读到只读单行要求:", idx.includes("只读取表格中该编号所在的那一行"));

  const pick = "q" + String(Math.floor(Math.random() * 20) + 1).padStart(2, "0");
  console.log("② 自主选题: " + pick);

  // 第一梯队：真的打开结果页
  const page = await get(B + "/draw/" + pick + ".html");
  const m = page.match(/<p class="question">([^<]+)<\/p>/);
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
})().catch((e) => console.log("ERR", e.message));
