/** 扁平项目组（只挂项目，不挂会话） */
export interface ProjectGroup {
  id: string;
  name: string;
  emoji?: string;
  color?: string;
  order: number;
}

/** 项目：本地目录或 ssh 远程目录的引用，作为会话的工作目录 */
export interface Project {
  id: string;
  name: string;
  path: string;
  /** 缺省 local;ssh 项目的工具调用全部在远端执行 */
  kind?: 'local' | 'ssh';
  /** kind='ssh' 时的 ssh 目标(user@host 或 ssh config 别名) */
  sshHost?: string;
  sshConnectionId?: string;
  sshConnectionName?: string;
  /** 所属项目组；缺省或指向已删组 = 未分组 */
  groupId?: string;
}

/** 从本地编辑器 / 编程应用读到的最近打开目录 */
export interface RecentProject {
  path: string;
  displayPath: string;
  sourceName: string;
}
