/**
 * Detects whether an assistant message is asking a yes/no style confirmation,
 * returning the localized button options (English or Turkish) or null.
 */
export function getConfirmationOptions(content: string): string[] | null {
  const cleanText = content.toLowerCase();

  if (
    cleanText.includes('(yes / no)') ||
    cleanText.includes('(yes/no)') ||
    cleanText.includes('yes/no') ||
    cleanText.includes('yes or no') ||
    cleanText.includes('do you confirm') ||
    cleanText.includes('do you approve') ||
    cleanText.includes('confirm?') ||
    cleanText.includes('approve?')
  ) {
    return ['Yes', 'No'];
  }

  if (
    cleanText.includes('(evet / hayır)') ||
    cleanText.includes('(evet/hayır)') ||
    cleanText.includes('evet/hayır') ||
    cleanText.includes('evet veya hayır') ||
    cleanText.includes('onaylıyor musun') ||
    cleanText.includes('onaylıyor musunuz') ||
    cleanText.includes('onaylar mısın') ||
    cleanText.includes('onaylar mısınız') ||
    cleanText.includes('onay veriyor musun') ||
    cleanText.includes('onay veriyor musunuz') ||
    cleanText.includes('onay istiyor')
  ) {
    return ['Evet', 'Hayır'];
  }

  return null;
}

/** Short label for a pending permission request (the target path or tool name). */
export function getPermissionPath(toolCall: any): string {
  if (!toolCall?.function?.arguments) return '';
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    return parsed.path || toolCall.function.name;
  } catch (e) {
    return toolCall.function.name;
  }
}

/** Resolves a permission tool call's arguments into a readable absolute path. */
export function getPermissionArguments(toolCall: any, projectPath?: string): string {
  if (!toolCall?.function?.arguments) return '';
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    if (parsed.path && projectPath) {
      const rel = parsed.path;
      const combined = projectPath.endsWith('/') || rel.startsWith('/')
        ? `${projectPath}${rel}`
        : `${projectPath}/${rel}`;
      return combined.replace(/([^:]\/)\/+/g, '$1');
    }
    return JSON.stringify(parsed);
  } catch (e) {
    return toolCall.function.arguments;
  }
}
