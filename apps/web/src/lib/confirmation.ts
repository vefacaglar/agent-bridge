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
