# AI 真心话扭蛋（MVP 验证版）

一个纯静态的小网站，用来验证一件事：**AI 能不能自己生成抽卡链接、真的打开这个链接、读到题目，然后回答这道题。**

没有 AI API、没有数据库、没有后台、没有账号登录。只有静态 HTML。

**用户只需要把链接发给 AI，不需要再下达任何指令** —— 抽卡指令已经分层埋在初始页里（见下文「AI 指令藏在哪里」）。

## 目录结构

```
cards/
├── index.html            # 初始页（含多层隐藏 AI 指令）              [生成]
├── draw/q01.html ... q20.html  # 20 个结果页，编号固定对应一道题   [生成]
├── ai.txt                # 给 AI 的纯文本指令                       [生成]
├── llms.txt              # 给 AI 抓取器的站点说明                    [生成]
├── robots.txt            # 含给 AI 的注释指令                       [生成]
├── assets/style.css      # 共用样式
├── questions.json        # ★ 题库：唯一需要手工维护的文件
├── src/index.template.html # 初始页模板                            [生成用]
├── tools/build.js        # 生成器：questions.json -> 静态页面
├── tools/check.js        # 校验器：检查编号/题目一一对应 + 指令埋点是否有效
├── tools/serve.js        # 本地预览服务器
├── netlify.toml / vercel.json / .github/workflows/deploy.yml  # 部署配置
├── README.md
└── TESTING.md            # 测试说明
```

`index.html` 与 `draw/*.html` 都是**生成产物**，请勿手改；改题库请改 `questions.json` 后重新生成。

## 题库维护

编辑 `questions.json`：

```json
{
  "prefix": "q",
  "pad": 2,
  "questions": [
    { "id": "q01", "text": "题目一……" },
    { "id": "q02", "text": "题目二……" }
  ]
}
```

- `id` 必须从 `q01` 开始连续编号，重复或跳号时生成器会报错，避免出现死链。
- 增删题目后重新运行 `node tools/build.js` 即可；新增题号会自动生成对应结果页。
- 题库顺序即抽卡编号，题目改动后编号映射随之改变（同一个编号仍然固定对应一道题）。

## 本地开发

```bash
node tools/build.js --base http://localhost:5173   # 生成本地版本
node tools/check.js                                # 校验编号与题目是否一一对应
node tools/serve.js                                # http://localhost:5173/
```

注意：AI 无法访问 `localhost`，正式验证必须使用公网 HTTPS 地址。

## 部署（任选其一，均为纯静态）

### 方式 A：Netlify（最快）

1. `netlify.toml` 已包含发布目录配置（publish = `.`）。
2. 把整个目录拖到 <https://app.netlify.com/drop>，或用 CLI：

   ```bash
   npx netlify-cli deploy --dir . --prod
   ```

3. 得到形如 `https://xxx.netlify.app` 的地址后，**重新生成一次**初始页，让页面里写的是真实域名：

   ```bash
   node tools/build.js --base https://xxx.netlify.app
   ```

4. 再次上传/提交生成结果。

> 第 3 步很关键：初始页里写给 AI 的“网站地址”必须是你实际能访问的域名。

### 方式 B：Vercel

```bash
npx vercel --prod
# 得到 https://xxx.vercel.app 后：
node tools/build.js --base https://xxx.vercel.app
npx vercel --prod
```

### 方式 C：GitHub Pages

仓库里已带 `.github/workflows/deploy.yml`：

1. 推送到 `main` 分支。
2. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
3. 工作流会用 `https://<owner>.github.io/<repo>` 作为站点地址重新生成页面并发布。

### 方式 D：任意静态服务器 / 对象存储

把 `index.html`、`draw/`、`assets/` 上传到任意支持静态文件的主机即可（Nginx、OSS、Cloudflare Pages、GitHub Pages 等）。无后端、无环境变量、无数据库。

## 部署后自查

```bash
# 1. 初始页可访问
curl -sI https://your-site/ | head -1            # 期望 200

# 2. 20 个结果页全部可访问，且题目互不相同
for i in $(seq -w 1 20); do
  curl -s https://your-site/draw/q$i.html | grep -o '<p class="question">.*</p>'
done

# 3. 初始页里写的是真实域名
curl -s https://your-site/ | grep -o 'https://your-site/draw/qNN.html'
```

## 入口与回退路径

| 入口 | 用途 |
| --- | --- |
| `https://cards.vicapt.top/` | 人看的站点（含复制按钮） |
| `https://raw.githubusercontent.com/Vicapt/marketproduct/main/index.html` | **发给 AI 的入口**（部分平台的工具打不开自定义域名，但能开 raw 域名） |

每道题都有三种等价形式、两个主机，内容完全一致：

```
{站点}/draw/qNN.html                              主地址
{站点}/draw/qNN.txt                               同主机纯文本
{raw}/draw/qNN.html                               raw 镜像（HTML 源码）
{raw}/draw/qNN.txt                                raw 镜像（纯文本）
{raw}/draw/qNN.json                               raw 镜像（JSON）
```

若某平台的工具**完全无法导航到新 URL**，初始页内嵌了完整题库（`编号｜题目`），
AI 可走降级路径，并被要求如实标注「降级路径：未能打开结果页」——题目仍是真读到的正文。

## AI 指令藏在哪里

用户在初始页点一下「复制扭蛋链接」，把 URL 丢给 AI 就结束了 —— **不需要用户再复制一段说明**。指令埋在初始页的多个位置，覆盖各种抓取方式：

| # | 位置 | 人类看到吗 | 什么抓取方式能读到 |
| --- | --- | --- | --- |
| 1 | `<head>` 里的 HTML 注释 | 看不到（源码视图除外） | 直接读源码的 AI / `curl` |
| 2 | `<meta name="ai-instruction">` | 看不到 | 保留 meta 的抓取器、网页摘要工具 |
| 3 | `<meta name="description">` + `og:description` | 看不到 | 同上 |
| 4 | `<div hidden class="ai-directive">` | 看不到 | 取 DOM 文本 / 转 Markdown 的抓取器 |
| 5 | `<details>` 里默认收起的「完整说明」 | 默认收起 | 取 DOM 文本的抓取器（兜底） |
| 6 | `<html data-ai-task="...">` 属性 | 看不到 | 读源码的 AI |
| 7 | `/ai.txt`、`/llms.txt`、`/robots.txt` | 纯文本，按约定抓取 | 会去读这些文件的 AI / 抓取机器人 |
| 8 | 结果页同样的埋点 | 看不到 | AI 抽到题后知道该「回答这道题」 |

指令正文统一由 [tools/build.js](tools/build.js) 生成，保证各处措辞一致、链接域名正确。

`node tools/check.js` 会模拟抓取器的行为（去掉 script/style/注释后取文本），确认指令在纯文本层依然读得到 —— 防止某次改动把埋点弄丢。

> 前提：AI 必须具备网页访问能力。没有联网能力的 AI 无法通过本测试（它应当如实报告失败）。

## 技术要点

- **结果页是纯静态 HTML**：题目文字直接写在 `<p class="question">` 正文里，不依赖 JS 执行、不藏在变量里、不用图片。这样 AI 的抓取工具能稳定读到原文。
- **固定映射**：`q07.html` 永远是第 7 题，重复访问、刷新都不变。
- **初始页不暴露题面**：初始页只写玩法和链接格式，不列出全部题目，避免 AI 直接抄题库而不去访问结果页。
- **初始页写死了站点地址**：即使 AI 只做纯文本抓取（不执行 JS），也能拿到正确的域名和编号范围。
- **结果页也埋了指令**：AI 抽到题后知道该「直接回答这道题」，而不是复述题目或反问用户。
- **复制按钮**：`navigator.clipboard` + `execCommand` 兜底；复制链接时优先使用**当前页面真实地址**（`location.origin`），所以即使忘记用真实域名重新构建，复制出来的链接也不会过期。初始页 HTML 里写给 AI 的地址则来自构建时传入的 `--base`。

## 不在本版本范围内

3D 模型、音效、抽卡动画、AI 对话接口、用户账号、支付、社交分享、后台管理、数据库、动态路由。

## 测试

见 [TESTING.md](TESTING.md)。
