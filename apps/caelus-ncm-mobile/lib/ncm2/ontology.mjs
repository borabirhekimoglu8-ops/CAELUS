export const EVENT_PATTERNS = [
  { type: "ATTACK", terms: ["siber saldiri", "saldiri", "hack", "fidye", "ransomware", "tehdit"], pressure: 0.86 },
  { type: "LEAK", terms: ["veri siz", "veri kayb", "sizinti", "leak"], pressure: 0.82 },
  { type: "STOP", terms: ["dur", "kapan", "iptal", "kesinti", "devre disi", "blok", "stop", "outage", "cancel"], pressure: 0.78 },
  { type: "REDUCE", terms: ["azal", "dus", "daral", "kaybet", "eksil", "reduce", "drop", "loss"], pressure: 0.62 },
  { type: "INCREASE", terms: ["art", "yuksel", "buyu", "yigil", "doluluk", "increase", "surge"], pressure: 0.58 },
  { type: "DELAY", terms: ["gecik", "bekle", "kuyruk", "delay"], pressure: 0.54 },
  { type: "FAIL", terms: ["ariza", "basarisiz", "devreye girmez", "calismaz", "fail"], pressure: 0.76 },
  { type: "PROTECT", terms: ["yedek", "jenerator", "koru", "saglam", "gecis plan", "izole", "rezerv", "backup", "protect"], pressure: -0.34 },
  { type: "RECOVER", terms: ["duzel", "iyiles", "normale don", "recover"], pressure: -0.28 },
];

export const ENTITY_PHRASES = [
  ["liman vinc yazilimi", "Liman vinç yazılımı", "SERVICE"], ["feribot seferleri", "Feribot seferleri", "SERVICE"],
  ["liman yukleme sistemi", "Liman yükleme sistemi", "SERVICE"], ["ro ro gecisi", "Ro-Ro geçişi", "SERVICE"],
  ["feribot talebi", "Feribot talebi", "DEMAND"], ["yolcu kuyrugu", "Yolcu kuyruğu", "DEMAND"],
  ["gumruk personeli", "Gümrük personeli", "CAPACITY"], ["gida sevkiyati", "Gıda sevkiyatı", "DEADLINE"],
  ["otel kapasitesi", "Otel kapasitesi", "CAPACITY"], ["turizm geliri", "Turizm geliri", "DEADLINE"],
  ["kimlik sunuculari", "Kimlik sunucuları", "GATE"], ["musteri verileri", "Müşteri verileri", "DEADLINE"],
  ["musteri verisi", "Müşteri verisi", "DEADLINE"], ["yedek jenerator", "Yedek jeneratör", "CAPACITY"],
  ["veri merkezi", "Veri merkezi", "SERVICE"], ["elektrik sebekesi", "Elektrik şebekesi", "SERVICE"],
  ["asiri sicak", "Aşırı sıcak", "ACTOR"],
  ["elektrik talebi", "Elektrik talebi", "DEMAND"], ["hastane beslemesi", "Hastane beslemesi", "DEADLINE"],
  ["oksijen tedariki", "Oksijen tedariki", "SERVICE"], ["ambulans yonlendirmesi", "Ambulans yönlendirmesi", "DEMAND"],
  ["cevre hastaneler", "Çevre hastaneler", "CAPACITY"], ["ithalat finansmani", "İthalat finansmanı", "GATE"],
  ["liman hacmi", "Liman hacmi", "DEADLINE"], ["stok tamponu", "Stok tamponu", "CAPACITY"],
  ["otomotiv fabrikasi", "Otomotiv fabrikası", "SERVICE"], ["gecis plani", "Geçiş planı", "CAPACITY"],
  ["piyasa guveni", "Piyasa güveni", "DEADLINE"], ["hizmet garantisi", "Hizmet garantisi", "CAPACITY"],
  ["planli bakim", "Planlı bakım", "SERVICE"], ["salt okunur", "Salt okunur servis", "SERVICE"],
  ["kritik iletisim", "Kritik iletişim", "DEADLINE"], ["gorev penceresi", "Görev penceresi", "DEADLINE"],
];

export const ROLE_CUES = [
  {
    role: 4, kind: "Adversary", semanticType: "ACTOR",
    terms: ["firtina", "sis", "deprem", "saldiri", "fidye", "rakip", "grev", "sok", "yangin", "tehdit", "hava"],
  },
  {
    role: 1, kind: "Queue", semanticType: "DEMAND",
    terms: ["yolcu", "talep", "kuyruk", "siparis", "olay", "ucus", "islem", "ambulans", "trafik", "bekleme"],
  },
  {
    role: 2, kind: "Buffer", semanticType: "CAPACITY",
    terms: ["kapasite", "yedek", "jenerator", "trafo", "stok", "rezerv", "yatak", "vinc", "filo", "personel", "tampon"],
  },
  {
    role: 3, kind: "Gate", semanticType: "GATE",
    terms: ["gumruk", "kimlik", "api", "mevzuat", "kurul", "guvenlik", "sinir", "pist", "sebeke"],
  },
  {
    role: 5, kind: "Perishable", semanticType: "DEADLINE",
    terms: ["hastane", "hasta", "veri", "gida", "otel", "gelir", "baglanti", "iletisim", "taahhut", "oksijen", "ilac", "vardiya"],
  },
  {
    role: 0, kind: "Service", semanticType: "SERVICE",
    terms: ["sefer", "servis", "liman", "fabrika", "uretim", "gorev", "merkez", "sistem", "operasyon", "arz", "hizmet"],
  },
];

export const RELATION_RULES = [
  { from: "ACTOR", to: "SERVICE", relation: "CAUSES", polarity: 1, base: 0.90, mechanism: "dış tetikleyici operasyon akışını doğrudan baskılar" },
  { from: "ACTOR", to: "GATE", relation: "BLOCKS", polarity: 1, base: 0.84, mechanism: "tetikleyici doğrulama veya karar kapısını daraltır" },
  { from: "SERVICE", to: "DEMAND", relation: "DELAYS", polarity: 1, base: 0.88, mechanism: "hizmet kaybı tamamlanamayan talebi kuyruğa taşır" },
  { from: "SERVICE", to: "DEADLINE", relation: "CAUSES", polarity: 1, base: 0.86, mechanism: "akış kesintisi zaman kritik sonucu doğrudan etkiler" },
  { from: "DEMAND", to: "CAPACITY", relation: "DEPLETES", polarity: 1, base: 0.82, mechanism: "biriken talep mevcut tampon kapasiteyi tüketir" },
  { from: "CAPACITY", to: "SERVICE", relation: "ENABLES", polarity: -1, base: 0.78, mechanism: "tampon kapasite hizmet kaybını sınırlar" },
  { from: "GATE", to: "SERVICE", relation: "GOVERNS", polarity: 1, base: 0.80, mechanism: "karar kapısındaki daralma hizmet hızını düşürür" },
  { from: "GATE", to: "DEMAND", relation: "DELAYS", polarity: 1, base: 0.78, mechanism: "kapı kapasitesi talebin işlenme hızını belirler" },
  { from: "CAPACITY", to: "DEADLINE", relation: "PROTECTS", polarity: -1, base: 0.76, mechanism: "rezerv kapasite kritik sonucu geçici olarak korur" },
  { from: "DEMAND", to: "DEADLINE", relation: "CAUSES", polarity: 1, base: 0.75, mechanism: "uzayan kuyruk zaman kritik kaybı büyütür" },
  { from: "SERVICE", to: "CAPACITY", relation: "DEPLETES", polarity: 1, base: 0.72, mechanism: "bozulan akış alternatif kapasiteyi daha hızlı tüketir" },
];

export const DOMAIN_EFFECTS = {
  MARITIME: ["bağlantı seferlerinin kaçırılması", "terminal ve konaklama kapasitesinin sıkışması", "yük ve yolcu birikimi"],
  AVIATION: ["slot zincirinin bozulması", "bağlantılı uçuş kaybı", "ekip ve filo rotasyon baskısı"],
  SUPPLY: ["tampon stoğun erimesi", "üretim vardiyasının daralması", "müşteri teslimatının gecikmesi"],
  FINANCE: ["likidite marjının daralması", "finansman maliyetinin yayılması", "güven ve hacim kaybı"],
  CYBER: ["kimlik doğrulama kesintisi", "olay kuyruğunun büyümesi", "veri bütünlüğü ve servis sürekliliği riski"],
  HEALTH: ["triyaj baskısının artması", "kritik malzeme ve yatak tamponunun erimesi", "çevre kurumlara yönlendirme"],
  ENERGY: ["rezerv marjının düşmesi", "kritik yüklerin ayrıştırılması", "ikincil altyapı kesintileri"],
  SPACE: ["enerji bütçesinin daralması", "komut penceresinin kaçırılması", "görev emniyet moduna geçiş"],
  SECURITY: ["karar penceresinin daralması", "kurumsal kapasitenin bölünmesi", "insani ve stratejik maliyetin büyümesi"],
  BUSINESS: ["hizmet seviyesinin bozulması", "müşteri kayıp oranının artması", "gelir ve güven baskısı"],
  UNIVERSAL: ["tampon kapasitenin erimesi", "karar penceresinin daralması", "ikincil sistemlere yayılım"],
};

export const ACTION_LIBRARY = {
  ACTOR: ["tetikleyiciyi izole et", "dış baskıyı doğrulanmış eşiklerle sınırla"],
  SERVICE: ["kritik hizmet akışını ayrı hatta taşı", "operasyon akışını asgari güvenli seviyede sabitle"],
  DEMAND: ["kuyruğu etki ve süre eşiğine göre sırala", "talebi alternatif kanallara dağıt"],
  CAPACITY: ["rezerv kapasiteyi kritik yola tahsis et", "tampon tüketimini eşik bazlı sınırla"],
  GATE: ["karar ve doğrulama kapısını hızlandır", "ortak otorite masasıyla tek karar hattı kur"],
  DEADLINE: ["zaman kritik sonucu koruma altına al", "geri döndürülemez eşikten önce müdahale et"],
};
