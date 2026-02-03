/**
 * country-filters.js
 * 住所テキストから地域カテゴリーを判定するロジック
 * 改良版: Current Addressの直後のみを厳密にターゲットにする
 */

// --- 辞書定義 ---
// 誤検知しやすい短い単語（ch, uk, usa等）は排除済み
const REGIONS = {
    SWITZERLAND: [
        "switzerland", "schweiz", "suisse", "svizzera", 
        "zurich", "zürich", "geneva", "genève", "bern", "lausanne", "basel", 
        "lucerne", "luzern", "lugano", "st. gallen", "vaud", "ticino"
    ],
    
    EUROPE: [
        "united kingdom", "great britain", "england", "scotland", "wales", "london", "edinburgh",
        "france", "paris", "germany", "deutschland", "berlin", "munich", "italy", "italia", "rome", "milano",
        "spain", "espana", "madrid", "barcelona", "netherlands", "holland", "amsterdam", "the hague",
        "belgium", "brussels", "austria", "vienna", "sweden", "stockholm", "norway", "oslo", 
        "denmark", "copenhagen", "finland", "helsinki", "ireland", "dublin", "portugal", "lisbon",
        "poland", "warsaw", "czech", "prague", "hungary", "budapest", "greece", "athens",
        "romania", "bulgaria", "slovakia", "croatia", "lithuania", "slovenia", "latvia", 
        "estonia", "cyprus", "luxembourg", "malta", "iceland", "liechtenstein"
    ],
    
    DEVELOPED: [
        "united states", "u.s.a", "america", "new york", "washington", "california", "texas",
        "canada", "toronto", "vancouver", "montreal", "japan", "tokyo", "osaka", 
        "australia", "sydney", "melbourne", "new zealand", "auckland", 
        "singapore", "south korea", "seoul", "israel", "tel aviv"
    ]
};

// --- 判定関数 ---

function determineRegion(fullText) {
    if (!fullText) return 'Others';

    // 1. ピンポイント抽出ロジック
    // "Current Address" (または "Living location") の後ろにある文字列を取得します。
    // \n (改行) が来るまで、または次の項目が始まるまでの短い範囲（最大100文字）をターゲットにします。
    
    let targetText = "";
    
    // 正規表現の解説:
    // Current Address[:\s]+  -> "Current Address" とその後のコロンやスペースにマッチ
    // ([^\n\r]{2,100})       -> 改行以外の文字を2文字以上100文字以内でキャプチャ
    const addressMatch = fullText.match(/Current Address[:\s]+([^\n\r]{2,100})/i);

    if (addressMatch && addressMatch[1]) {
        // 成功！住所欄だけをターゲットにする
        targetText = addressMatch[1].toLowerCase();
        // console.log("Address Found:", targetText); // デバッグ用
    } else {
        // 失敗した場合の保険（Fallback）
        // ご提案通り、読み込む文字数を大幅に減らします（冒頭300文字のみ）。
        // PHPのCurrent Addressはかなり上部にあるため、これで十分です。
        targetText = fullText.substring(0, 300).toLowerCase();
    }

    // 2. 優先順位付き判定

    // Check 1: Switzerland
    if (REGIONS.SWITZERLAND.some(keyword => targetText.includes(keyword))) {
        return 'Switzerland';
    }

    // Check 2: Europe
    if (REGIONS.EUROPE.some(keyword => targetText.includes(keyword))) {
        return 'Europe';
    }

    // Check 3: Developed
    if (REGIONS.DEVELOPED.some(keyword => targetText.includes(keyword))) {
        return 'Developed';
    }

    // Check 4: Others
    return 'Others';
}