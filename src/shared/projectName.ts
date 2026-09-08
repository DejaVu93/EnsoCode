/** 目录路径的最后一段作为项目名；同时兼容 posix 与 Windows 分隔符 */
export function projectNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 历史数据里 Windows 项目名被存成了完整路径，展示时重新推导 */
export function projectDisplayName(project: { name: string; path: string }): string {
  return project.name === project.path ? projectNameFromPath(project.path) : project.name;
}
