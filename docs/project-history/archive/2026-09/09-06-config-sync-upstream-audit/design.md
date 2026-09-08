# 配置包契约

以 SettingsState 非函数字段为覆盖源，策略表必须穷尽。安全可移植偏好直接校验并传输；模型引用随 provider ID 映射；资源进入受控本地目录。机器绝对路径、代理、OAuth 登录态、会话及项目状态保留本地值。

包维持 version 1，新增字段可选以兼容旧包；缺省字段不覆盖本地偏好。导入只改变已验证白名单，其他 store 不变。

流程：Renderer → preload → 参数校验 → codec/merge → settings transaction。预览绑定 sender/token/mode/settings 指纹。事务先 flush、备份完整设置、原子写，再更新缓存和广播。失败清理暂存资源；成功资源需与备份一起保留以支持恢复。

加密包可携带 API/MCP 凭证及资源内容，OAuth 仅记录省略信息。明文不包含资源内容。预览统计涵盖集合与默认设置，明确替换删除；导入有来源信任确认。
