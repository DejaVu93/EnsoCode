import { classifyEditArgs } from './classify';
import { EDIT_INVALID_MESSAGE } from './prompts';

export interface HashlineEditHandlers {
  applyReplace: (params: unknown) => unknown;
  applyHashline: (params: unknown) => unknown;
}

export function createHashlineEditTool(handlers: HashlineEditHandlers) {
  return {
    name: 'edit',
    async execute(_id: string, params: unknown) {
      const kind = classifyEditArgs(params).kind;
      if (kind === 'replace') return handlers.applyReplace(params);
      if (kind === 'hashline') return handlers.applyHashline(params);
      throw new Error(EDIT_INVALID_MESSAGE);
    },
  };
}
