// 季节限定题登记表。
// build.js（生成）和 check.js（校验）共用这一份，避免两边各写一遍、写着写着就岔了。
//
// 用法：题库里给某道题加一个 season 字段，值必须是下面表里的键：
//   { "id": "q26", "season": "halloween", "text": "..." }
// 生成之后，这道题在结果页角标、给 AI 的指令、隐藏题库表格、
// 纯文本镜像、index.json 里都会带上同一个标签。
//
// 过季之后：把 season 字段删掉，这道题就变回常驻题（编号不变）。
// 新增一个节日就往表里加一条。
module.exports = {
  SEASONS: {
    halloween: {
      label: "万圣节限定",
      en: "HALLOWEEN",
      // 节日期间（闭区间，月-日）。AI 用它自己知道的当前日期来判断在不在期间内。
      window: { from: "10-24", to: "11-01" }
    }
  },

  // 题目的季节标签；没有 season 字段就是常驻题，返回 null
  seasonOf(q) {
    return q.season ? module.exports.SEASONS[q.season] || null : null;
  },

  // 节日期间的文字描述，给 AI 读
  windowText(season) {
    if (!season || !season.window) return "";
    const f = season.window.from.split("-");
    const t = season.window.to.split("-");
    return (
      Number(f[0]) + " 月 " + Number(f[1]) + " 日至 " +
      Number(t[0]) + " 月 " + Number(t[1]) + " 日"
    );
  }
};
