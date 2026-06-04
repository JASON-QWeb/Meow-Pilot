export const strings = {
  "app.nav.avatar": "形象",
  "app.nav.home": "主页",
  "app.nav.tasks": "任务",
  "app.nav.usage": "用量",
  "app.nav.friends": "好友",
  "app.nav.chat": "会话",
  "app.nav.memory": "记忆",
  "app.nav.skills": "Skill",
  "app.nav.tools": "工具",
  "app.nav.config": "配置",
  "app.nav.account": "账户",
  "app.nav.exit": "退出",
  "app.header.overview": "总览",
  "app.header.newTask": "新任务",
  "app.header.search": "搜索",
  "app.header.searchPlaceholder": "Search",
  "app.header.notifications": "通知",
  "app.status.connecting": "连接中",
  "app.status.ready": "已连接",
  "app.status.offline": "离线",
  "app.view.home": "Q Console",
  "app.view.chat": "会话",
  "app.view.friends": "好友宠物",
  "app.view.custom": "形象工作室",
  "app.view.usage": "用量看板",
  "app.view.tasks": "定时任务",
  "app.view.memory": "记忆",
  "app.view.skills": "Skill",
  "app.view.tools": "工具与权限",
  "app.view.config": "配置",
} as const;

export type StringKey = keyof typeof strings;

export function t(key: StringKey) {
  return strings[key];
}
