declare module 'cytoscape-fcose' {
  import type cytoscape from 'cytoscape';

  /** fCoSE 布局插件；只在 cytoscape.use() 里用得到，不需要更细的类型 */
  const fcose: cytoscape.Ext;
  export default fcose;
}
