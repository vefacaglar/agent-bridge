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
    /\b(on approval|with your approval|if you approve)\b/.test(cleanText) ||
    /\b(is this ok|is that ok|does that work for you)\??/.test(cleanText) ||
    /\b(should i start|shall i start|should i proceed|shall i proceed)\b/.test(cleanText)
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
    cleanText.includes('onay istiyor') ||
    cleanText.includes('onayınla') ||
    cleanText.includes('onayınızla') ||
    cleanText.includes('onay verirsen') ||
    cleanText.includes('onay verirseniz') ||
    cleanText.includes('onaylarsan') ||
    cleanText.includes('onaylarsanız') ||
    cleanText.includes('başlayayım mı') ||
    cleanText.includes('başlıyorum mu') ||
    cleanText.includes('devam edeyim mi') ||
    cleanText.includes('devam etmemi ister misin') ||
    cleanText.includes('uygun mu') ||
    cleanText.includes('diyor musun') ||
    cleanText.includes('diyorsun')
  ) {
    return ['Evet', 'Hayır'];
  }

  return null;
}
