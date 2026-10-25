#!/usr/bin/env node
/**
 * 本地静态预览服务器（仅用于本地调试，不参与部署）。
 *
 * 用法：
 *   node tools/serve.js [端口]                 默认 5173
 *   node tools/serve.js 5173 --open [路径]      起服务并自动用默认浏览器打开
 *   node tools/serve.js 5173 --open draw/q07.html
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);

// 先摘掉 --open 及其后的路径，剩下的第一个位置参数当端口
let OPEN = false;
let OPEN_PATH = "";
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--open") {
    OPEN = true;
    const next = argv[i + 1];
    // --open 后面只有当它不像端口、也不像别的开关时，才当作要打开的路径
    if (next && !next.startsWith("-") && !/^\d+$/.test(next)) {
      // Windows 上手写的路径可能是 draw\q07.html，
      // URL 里必须是正斜杠
      OPEN_PATH = next.replace(/\\/g, "/");
      i++;
    }
    continue;
  }
  rest.push(argv[i]);
}
const PORT = Number(rest[0] || process.env.PORT || 5173);

// MIME 表要和线上（GitHub Pages）保持一致，
// 否则本地预览就是在某个维度上骗你 —— 比如 .txt 兜底成 octet-stream 后，
// 浏览器会把它当二进制触发下载，而不是显示纯文本。
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// 本地也要按线上那样压缩。
// GitHub Pages 会自动给 .js / .html 等开 gzip/brotli，
// 本地服务器明文直发时，测出来的传输体积会比线上大好几倍，
// 拿来做加载时间判断会失真。
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".xml", ".txt"]);

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath);
    const headers = {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    };

    const wantsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (wantsGzip && COMPRESSIBLE.has(ext)) {
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      res.writeHead(200, headers);
      fs.createReadStream(filePath)
        .pipe(zlib.createGzip({ level: 9 }))
        .pipe(res);
      return;
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  })
  .listen(PORT, () => {
    const url = `http://localhost:${PORT}/${OPEN_PATH}`.replace(/\/+$/, "/");
    console.log(`本地预览：http://localhost:${PORT}/`);
    console.log(`示例结果页：http://localhost:${PORT}/draw/q07.html`);
    if (OPEN) {
      console.log(`正在打开浏览器：${url}`);
      openBrowser(url);
    }
  });

// 用系统默认浏览器打开（Windows 用 start，macOS 用 open，Linux 用 xdg-open）
function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };
  try {
    spawn(cmd.file, cmd.args, { detached: true, stdio: "ignore" }).unref();
  } catch (e) {
    console.log(`（自动打开浏览器失败，手动访问：${url}）`);
  }
}
