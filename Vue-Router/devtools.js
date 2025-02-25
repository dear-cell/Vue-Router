// 创建开发者工具面板
chrome.devtools.panels.create(
  "Vue Routes",
  null,
  "panel.html",
  function(panel) {
    console.log("面板创建成功");
  }
); 