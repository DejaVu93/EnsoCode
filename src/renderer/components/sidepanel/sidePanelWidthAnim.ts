export function shouldSkipSidePanelWidthAnim(input: {
  resizing: boolean;
  conversationId?: string;
  previousConversationId?: string;
}): boolean {
  if (input.resizing) return true;
  return (
    input.previousConversationId !== undefined &&
    input.conversationId !== undefined &&
    input.previousConversationId !== input.conversationId
  );
}
