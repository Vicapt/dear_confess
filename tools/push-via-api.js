#!/usr/bin/env node
/**
 * 通过 GitHub REST API（api.github.com）推送本地提交。
 *
 * 用途：某些网络环境下 github.com 的 git 传输端点不可达（连接超时/被重置），
 * 但 api.github.com 可用。本脚本用 Git Database API 复现本地提交：
 *   1. 读取本地待推送的提交与文件差异
 *   2. 通过 API 上传 blob，构造与本地完全一致的 tree
 *   3. 用与本地一致的作者/时间/信息创建 commit（commit sha 因此与本地一致）
 *   4. 更新 refs/heads/main
 *
 * 不会修改 GitHub 账号的任何设置，凭证从 Git Credential Manager 读取。
 *
 * 用法：node tools/push-via-api.js [--repo owner/name]
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const API = "https://api.github.com";

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function token() {
  const out = execFileSync(
    "git",
    ["credential-manager", "get"],
    {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8"
    }
  );
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error("未能从 Git Credential Manager 取得凭证");
  return m[1].trim();
}

async function api(tok, method, endpoint, body) {
  const res = await fetch(API + endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + tok,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cards-push-helper"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      method + " " + endpoint + " -> " + res.status + " " + (data && data.message ? data.message : text)
    );
  }
  return data;
}

async function main() {
  const repoArgIndex = process.argv.indexOf("--repo");
  const repo = repoArgIndex > -1 ? process.argv[repoArgIndex + 1] : "Vicapt/dear_confess";
  const [owner, name] = repo.split("/");

  const tok = token();
  const branch = "main";
  const headSha = git("rev-parse", "HEAD");
  const headTree = git("rev-parse", "HEAD^{tree}");
  const message = git("log", "-1", "--format=%B");
  const authorName = git("log", "-1", "--format=%an");
  const authorEmail = git("log", "-1", "--format=%ae");
  const authorDate = git("log", "-1", "--format=%aI");
  const committerName = git("log", "-1", "--format=%cn");
  const committerEmail = git("log", "-1", "--format=%ce");
  const committerDate = git("log", "-1", "--format=%cI");

  // 远程 head 一律以 API 为准（本地 origin/ 引用可能因网络中断而落后）
  const ref = await api(tok, "GET", `/repos/${owner}/${name}/git/ref/heads/${branch}`);
  const remoteSha = ref.object.sha;
  const remoteCommit = await api(tok, "GET", `/repos/${owner}/${name}/git/commits/${remoteSha}`);
  const remoteTree = remoteCommit.tree.sha;

  console.log("远程 head：" + remoteSha.slice(0, 7) + "（以 API 为准）");
  console.log("本地 HEAD：" + headSha.slice(0, 7) + " tree=" + headTree.slice(0, 7));

  if (remoteSha === headSha) {
    console.log("远程已是本地提交，无需推送。");
    return;
  }

  // 远程已有的 blob 不必重传（blob sha 是内容的哈希，与本地一致）
  const remoteBlobs = new Map();
  const remoteTreeFull = await api(
    tok,
    "GET",
    `/repos/${owner}/${name}/git/trees/${remoteTree}?recursive=1`
  );
  (remoteTreeFull.tree || []).forEach((e) => {
    if (e.type === "blob") remoteBlobs.set(e.path, e.sha);
  });

  // 本地 HEAD 的完整文件清单
  const localEntries = git("ls-tree", "-r", "HEAD").split("\n").filter(Boolean);
  const uploaded = [];
  const treeEntries = [];
  for (const line of localEntries) {
    const meta = line.match(/^(\d+) blob ([0-9a-f]{40})\t(.+)$/);
    if (!meta) continue;
    const [, mode, sha, file] = meta;
    if (remoteBlobs.get(file) !== sha) {
      // 必须从 git 对象库里取内容，而不是从工作区读文件：
      // 工作区可能是 CRLF（core.autocrlf），而 git 存的是 LF，
      // 两者算出的 blob sha 不同，会导致上传校验失败。
      const content = execFileSync("git", ["cat-file", "blob", sha], {
        cwd: ROOT,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024
      });
      const blob = await api(tok, "POST", `/repos/${owner}/${name}/git/blobs`, {
        content: content.toString("base64"),
        encoding: "base64"
      });
      if (blob.sha !== sha) {
        throw new Error(file + " 上传后 sha 不一致：" + blob.sha + " != " + sha);
      }
      uploaded.push(file);
    }
    treeEntries.push({ path: file, mode: mode, type: "blob", sha: sha });
  }
  console.log("需上传 blob：" + uploaded.length + " 个（其余远程已有，按 sha 复用）");

  // 构造完整 tree（以远程 tree 为底，逐项覆盖）
  const newTree = await api(tok, "POST", `/repos/${owner}/${name}/git/trees`, {
    base_tree: remoteTree,
    tree: treeEntries
  });
  if (newTree.sha !== headTree) {
    console.log("注意：API 构造的 tree 与本地 tree 不一致");
    console.log("  API : " + newTree.sha);
    console.log("  local: " + headTree);
  } else {
    console.log("tree 一致：" + headTree.slice(0, 7));
  }

  // 创建 commit（父提交为远程真实 head，保证是快进）
  const commit = await api(tok, "POST", `/repos/${owner}/${name}/git/commits`, {
    message,
    tree: headTree,
    parents: [remoteSha],
    author: { name: authorName, email: authorEmail, date: authorDate },
    committer: { name: committerName, email: committerEmail, date: committerDate }
  });
  console.log("API commit: " + commit.sha.slice(0, 7) + (commit.sha === headSha ? "（与本地一致）" : ""));

  // 更新分支
  await api(tok, "PATCH", `/repos/${owner}/${name}/git/refs/heads/${branch}`, {
    sha: commit.sha,
    force: false
  });
  console.log("已更新 refs/heads/" + branch + " -> " + commit.sha.slice(0, 7));

  // 若 API 生成的 commit 与本地一致，则可直接对齐本地引用
  if (commit.sha === headSha) {
    git("update-ref", "refs/remotes/origin/" + branch, commit.sha);
    console.log("本地 origin/" + branch + " 已同步");
  } else {
    console.log(
      "提示：API 生成的 commit 与本地 sha 不同（内容一致）。" +
        "等 github.com 可达后执行 `git fetch origin && git reset --hard origin/main` 即可完全对齐。"
    );
  }
}

main().catch((e) => {
  console.error("推送失败：" + e.message);
  process.exit(1);
});
