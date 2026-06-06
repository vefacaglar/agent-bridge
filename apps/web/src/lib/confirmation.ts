export interface ConfirmationQuestion {
  question: string;
  options: string[];
}

export function parseConfirmations(content: string): ConfirmationQuestion[] {
  const confirmations: ConfirmationQuestion[] = [];
  const regex = /<confirm\b([^>]*)>([\s\S]*?)<\/confirm>/ig;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const attrs = match[1];
    const questionText = match[2].trim();
    
    let options: string[] = [];
    const optMatch = /options="([^"]+)"/i.exec(attrs);
    if (optMatch) {
      options = optMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    } else {
      const isTurkish = /[\u011e\u011f\u0130\u0131\u015e\u015f\u00c7\u00e7\u00d6\u00f6\u00dc\u00fc]/i.test(questionText) || 
        /\b(evet|hayır|onay|başla|devam|uygun|mı|mi|mu|mü)\b/i.test(questionText.toLowerCase());
      options = isTurkish ? ['Evet', 'Hayır'] : ['Yes', 'No'];
    }
    
    confirmations.push({
      question: questionText,
      options
    });
  }
  return confirmations;
}

export function getConfirmations(content: string): ConfirmationQuestion[] {
  const parsed = parseConfirmations(content);
  if (parsed.length > 0) return parsed;

  const legacyOptions = getConfirmationOptionsOnly(content);
  if (legacyOptions) {
    return [{
      question: '',
      options: legacyOptions
    }];
  }

  return [];
}

export function getConfirmationOptions(content: string): string[] | null {
  const confs = getConfirmations(content);
  if (confs.length === 0) return null;
  return confs[0].options;
}

function getConfirmationOptionsOnly(content: string): string[] | null {
  const cleanText = content.toLowerCase();

  if (
    /<confirm\b/i.test(content) ||
    /<\/confirm>/i.test(content)
  ) {
    const match = /<confirm\s+[^>]*options="([^"]+)"/i.exec(content);
    if (match) {
      return match[1].split(',').map(s => s.trim()).filter(Boolean);
    }
    const isTurkish = /[\u011e\u011f\u0130\u0131\u015e\u015f\u00c7\u00e7\u00d6\u00f6\u00dc\u00fc]/i.test(content) || 
      /\b(evet|hayır|onay|başla|devam|uygun|mı|mi|mu|mü)\b/i.test(cleanText);
    return isTurkish ? ['Evet', 'Hayır'] : ['Yes', 'No'];
  }

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
