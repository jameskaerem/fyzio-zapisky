/*
 * Subject presets for physiotherapy university admission prep
 * (biology incl. human biology, physics, chemistry incl. biochemistry).
 * Each preset has: transcription context, key terms (short, <= 5 words each,
 * <= 100 per subject) and subject-specific rules for the study notes.
 */
(function () {
  "use strict";

  const SUBJECTS = {
    chemie: {
      label: "Chemie",
      icon: "🧪",
      context:
        "Výuková hodina chemie v češtině, příprava na přijímací zkoušky na fyzioterapii. " +
        "Obecná, anorganická, organická chemie a biochemie. Vzorce se často čtou po písmenech a číslech, " +
        "např. „há dva es o čtyři“ znamená H2SO4.",
      terms: [
        "oxidační číslo", "oxid", "hydroxid", "kyselina", "sůl", "bezkyslíkatá kyselina", "kyslíkatá kyselina",
        "kyselina sírová", "kyselina chlorovodíková", "kyselina dusičná", "kyselina fosforečná", "kyselina uhličitá",
        "hydroxid sodný", "hydroxid vápenatý", "chlorid sodný", "hydrogenuhličitan sodný", "amoniak",
        "H2SO4", "HCl", "HNO3", "H3PO4", "NaOH", "Ca(OH)2", "H2O", "CO2", "NaCl", "NaHCO3", "NH3",
        "-natý", "-itý", "-ičitý", "-ečný", "-ičný", "-istý", "-ičelý",
        "mol", "molární hmotnost", "látkové množství", "molární koncentrace", "hmotnostní zlomek",
        "Avogadrova konstanta", "pH", "pufr", "neutralizace", "hydrolýza", "redoxní reakce", "oxidace", "redukce",
        "elektronegativita", "valenční elektrony", "kovalentní vazba", "iontová vazba", "vodíkové můstky",
        "kation", "anion", "izotop", "periodická tabulka", "katalyzátor", "chemická rovnováha",
        "uhlovodíky", "alkany", "alkeny", "aromáty", "alkoholy", "aldehydy", "ketony", "karboxylové kyseliny",
        "estery", "aminy", "funkční skupina", "izomerie",
        "sacharidy", "glukóza", "fruktóza", "sacharóza", "škrob", "glykogen", "celulóza",
        "lipidy", "mastné kyseliny", "triacylglyceroly", "fosfolipidy", "cholesterol",
        "aminokyseliny", "peptidová vazba", "bílkoviny", "enzymy", "koenzym", "nukleové kyseliny",
        "DNA", "RNA", "ATP", "NADH", "glykolýza", "Krebsův cyklus", "dýchací řetězec",
        "beta-oxidace", "fotosyntéza", "vitamíny", "hormony",
      ],
      notesRules: `- Chemické vzorce piš s indexy v Unicode (H₂O, H₂SO₄, Ca(OH)₂), náboje iontů horním indexem (Na⁺, SO₄²⁻), oxidační čísla římskými číslicemi, např. Fe(III) nebo S^VI.
- Rovnice piš na samostatný řádek, např. "2 H₂ + O₂ → 2 H₂O"; vyčísli je, pokud je to z kontextu jednoznačné.
- U názvosloví uveď vždy název i vzorec (kyselina sírová – H₂SO₄).
- Výpočty (látkové množství, koncentrace, ředění, pH) rozepiš krok za krokem: zadání, vzorec, dosazení, výsledek s jednotkou.
- U biochemie zdůrazni význam pro lidské tělo (metabolismus, svaly, energie).`,
    },

    fyzika: {
      label: "Fyzika",
      icon: "⚙️",
      context:
        "Výuková hodina fyziky v češtině, příprava na přijímací zkoušky na fyzioterapii. " +
        "Mechanika, biomechanika, kmitání a vlnění, elektřina a magnetismus, termika, optika, " +
        "jaderná fyzika a fyzikální veličiny s jednotkami.",
      terms: [
        "fyzikální veličina", "jednotka SI", "rychlost", "zrychlení",
        "rovnoměrný pohyb", "rovnoměrně zrychlený pohyb", "volný pád", "tíhové zrychlení", "pohyb po kružnici",
        "úhlová rychlost", "dostředivá síla", "Newtonovy pohybové zákony", "zákon setrvačnosti", "zákon akce a reakce",
        "síla", "hmotnost", "tíhová síla", "třecí síla", "součinitel tření", "hybnost", "impulz síly",
        "mechanická práce", "výkon", "účinnost", "kinetická energie", "potenciální energie",
        "zákon zachování energie", "moment síly", "momentová věta", "páka", "rameno síly", "těžiště",
        "rovnovážná poloha", "moment setrvačnosti", "deformace", "Hookův zákon",
        "normálové napětí", "modul pružnosti", "mez pevnosti",
        "tlak", "hydrostatický tlak", "atmosférický tlak", "Pascalův zákon", "Archimédův zákon",
        "vztlaková síla", "rovnice kontinuity", "Bernoulliho rovnice", "viskozita", "laminární proudění",
        "kmitání", "perioda", "frekvence", "amplituda", "rezonance", "vlnová délka", "zvuk",
        "ultrazvuk", "Dopplerův jev", "hladina intenzity zvuku", "decibel",
        "elektrický náboj", "Coulombův zákon", "elektrické pole", "elektrické napětí", "elektrický proud",
        "elektrický odpor", "Ohmův zákon", "kondenzátor", "kapacita", "elektrický výkon", "střídavý proud",
        "magnetické pole", "elektromagnetická indukce", "elektroterapie", "galvanický proud",
        "teplota", "teplo", "měrná tepelná kapacita", "tepelná výměna", "termoterapie",
        "světlo", "lom světla", "index lomu", "čočka", "optická mohutnost", "dioptrie",
        "elektromagnetické záření", "infračervené záření", "ultrafialové záření", "rentgenové záření",
        "radioaktivita", "poločas přeměny", "newton", "joule", "watt", "pascal", "hertz", "volt", "ampér", "ohm",
      ],
      notesRules: `- U každé veličiny uveď značku a jednotku, např. síla F [N], tlak p [Pa].
- Vzorce piš čitelně na samostatný řádek s exponenty a indexy v Unicode, např. "F = m · a", "Eₖ = ½ · m · v²", "p = F / S".
- Výpočty rozepiš krok za krokem: zadání, převod jednotek, vzorec, dosazení, výsledek s jednotkou.
- Pokud to v hodině zaznělo, uveď souvislost s lidským tělem nebo fyzioterapií (páky a svaly, těžiště, elektroterapie, ultrazvuk, termoterapie).`,
    },

    biologie: {
      label: "Biologie",
      icon: "🧬",
      context:
        "Výuková hodina biologie v češtině, příprava na přijímací zkoušky na fyzioterapii. " +
        "Obecná biologie, buňka, molekulární biologie, genetika, mikrobiologie, botanika, zoologie, ekologie a evoluce.",
      terms: [
        "prokaryotická buňka", "eukaryotická buňka", "buněčná membrána", "cytoplazma", "jádro", "jadérko",
        "mitochondrie", "ribozom", "endoplazmatické retikulum", "Golgiho aparát", "lyzozom", "centrozom",
        "cytoskelet", "chloroplast", "buněčná stěna", "vakuola", "difuze", "osmóza", "aktivní transport",
        "endocytóza", "exocytóza", "buněčný cyklus", "interfáze", "mitóza", "meióza", "profáze", "metafáze",
        "anafáze", "telofáze", "crossing-over", "apoptóza", "chromozom", "chromatida", "centromera",
        "gen", "alela", "genotyp", "fenotyp", "homozygot", "heterozygot", "dominance", "recesivita",
        "neúplná dominance", "kodominance", "Mendelovy zákony", "monohybridismus", "dihybridismus",
        "Punnettův čtverec", "genetická vazba", "dědičnost vázaná na pohlaví", "gonozomy", "autozomy",
        "karyotyp", "mutace", "Downův syndrom", "hemofilie", "daltonismus", "replikace", "transkripce",
        "translace", "proteosyntéza", "genetický kód", "kodon", "antikodon", "mRNA", "tRNA", "DNA", "RNA",
        "nukleotid", "komplementarita bází", "adenin", "guanin", "cytosin", "thymin", "uracil",
        "viry", "bakterie", "prvoci", "houby", "fotosyntéza", "buněčné dýchání", "enzymy", "homeostáza",
        "taxonomie", "ekosystém", "potravní řetězec", "symbióza", "parazitismus", "evoluce", "přirozený výběr",
      ],
      notesRules: `- Odborné pojmy při prvním výskytu zvýrazni tučně a stručně vysvětli.
- Srovnání (např. mitóza vs. meióza, prokaryota vs. eukaryota, DNA vs. RNA) dej do tabulky.
- Genetické příklady rozepiš: zápis genotypů rodičů, gamety, kombinační čtverec jako tabulka, poměr genotypů a fenotypů.
- Procesy (proteosyntéza, buněčné dělení) popiš jako číslovaný seznam kroků.`,
    },

    somatologie: {
      label: "Somatologie",
      icon: "🦴",
      context:
        "Výuková hodina somatologie (anatomie a fyziologie člověka) v češtině, příprava na přijímací zkoušky " +
        "na fyzioterapii. Používají se české i latinské anatomické názvy, pohybová terminologie a orgánové soustavy.",
      terms: [
        "anatomická poloha", "sagitální rovina", "frontální rovina", "transverzální rovina", "proximální",
        "distální", "mediální", "laterální", "ventrální", "dorzální", "kraniální", "kaudální",
        "flexe", "extenze", "abdukce", "addukce", "rotace", "pronace", "supinace", "dorzální flexe",
        "plantární flexe", "lebka", "páteř", "obratel", "krční páteř", "hrudní páteř", "bederní páteř",
        "kost křížová", "meziobratlová ploténka", "hrudní kost", "žebra", "lopatka", "klíční kost",
        "pažní kost", "loketní kost", "vřetenní kost", "pánev", "kyčelní kost", "stehenní kost",
        "holenní kost", "lýtková kost", "čéška", "kloub", "chrupavka", "vaz", "šlacha",
        "os femoris", "humerus", "scapula", "columna vertebralis", "kosterní sval",
        "hladká svalovina", "srdeční svalovina", "sarkomera", "aktin", "myozin", "svalový tonus",
        "musculus biceps brachii", "musculus triceps brachii", "musculus deltoideus",
        "musculus quadriceps femoris", "musculus gluteus maximus", "musculus triceps surae",
        "musculus trapezius", "musculus iliopsoas", "bránice", "začátek a úpon svalu",
        "neuron", "synapse", "akční potenciál", "mícha", "mozek", "mozeček",
        "reflexní oblouk", "míšní nervy", "sympatikus", "parasympatikus", "srdce",
        "síň", "komora", "chlopně", "aorta", "tepna", "žíla", "vlásečnice", "krevní tlak", "erytrocyty",
        "leukocyty", "trombocyty", "hemoglobin", "plíce", "průdušnice", "průdušky",
        "plicní sklípky", "ledviny", "nefron", "hypofýza", "štítná žláza", "inzulin", "smyslové orgány",
      ],
      notesRules: `- U anatomických struktur uveď český i latinský název, pokud zazněl nebo je běžný (stehenní kost – os femoris).
- Sval popisuj strukturou: začátek, úpon, funkce, inervace – jen to, co v hodině zaznělo.
- Pohyby a směry piš přesnou terminologií (flexe, abdukce, proximální…).
- Přehledy (kosti končetiny, svaly podle funkce, části srdce, krevní elementy) dej do tabulek.
- Fyziologické děje (srdeční cyklus, vedení vzruchu, svalová kontrakce) popiš jako číslovaný seznam kroků.`,
    },
  };

  const topicList = (topics) => (topics && topics.length
    ? topics.map((t) => `- ${t}`).join("\n")
    : "(zatím žádné)");

  const BASE_NOTES_PROMPT = (subject, existingTopics) => `Jsi pečlivý asistent, který připravuje studentku na přijímací zkoušky na vysokou školu, obor fyzioterapie. Dostaneš automatický přepis české výukové hodiny předmětu ${subject.label}. Vytvoř z něj přehledné studijní zápisky v češtině ve formátu Markdown.

Výstup MUSÍ začínat přesně těmito dvěma řádky metadat a oddělovačem, teprve potom zápisky:
TÉMA: <název složky – širší tematický celek předmětu>
NÁZEV: <název hodiny>
---

Pravidla pro metadata:
- TÉMA je širší celek podle osnov přijímaček (např. chemie: "Anorganické názvosloví", "Chemické výpočty", "Biochemie – bílkoviny"; somatologie: "Pohybová soustava – kosti", "Oběhová soustava"; fyzika: "Mechanika – síly a pohyb", "Elektřina a magnetismus"; biologie: "Genetika", "Buňka").
- Existující složky předmětu ${subject.label}:
${topicList(existingTopics)}
- Pokud hodina patří do některé existující složky, použij PŘESNĚ její název. Novou složku vytvoř jen tehdy, když žádná nesedí.
- NÁZEV piš ve tvaru "<Hlavní téma> – <konkrétní obsah>", stručně (max. 70 znaků), bez slova "hodina" a bez data, např. "Kyslíkaté kyseliny – názvosloví a vzorce" nebo "Kosti horní končetiny – pletenec a volná končetina".

Obecná pravidla pro zápisky:
- Začni nadpisem "# " s výstižným názvem tématu hodiny a pod ním krátkým shrnutím (2–4 věty).
- Obsah rozděl do sekcí "##" (případně "###") podle témat v pořadí, v jakém zazněla.
- Důležité definice, pravidla a vzorce dej do calloutu: řádek začínající "> 💡 **Klíčové:** ".
- Časté chyby a záludnosti z testů: "> ⚠️ **Pozor:** ". Řešené příklady: "> 🧪 **Příklad:** ".
- Opravuj zjevné chyby automatického přepisu v odborných pojmech, ale nevymýšlej nic, co v hodině nezaznělo. Pokud si nejsi jistý, napiš „(nejasné v záznamu)“.
- Vynech organizační řeči a odbočky. Zadané úkoly, testy a termíny ale uveď v sekci "## Organizační informace".

Pravidla pro předmět ${subject.label}:
${subject.notesRules}

Na konec přidej:
- "## Klíčové body" (5–10 odrážek),
- "## Testové otázky" – 5 otázek ve stylu přijímacích testů (výběr ze 4 možností a–d) k probranému učivu,
- "## Řešení" se správnými odpověďmi a jednovětým vysvětlením.`;

  // Used for the first audio part while the subject is still unknown
  const AUTO_CONTEXT =
    "Výuková hodina v češtině, příprava na přijímací zkoušky na fyzioterapii. Předmět je chemie, fyzika, " +
    "biologie nebo somatologie (anatomie a fyziologie člověka).";
  const AUTO_TERMS = () => Object.values(SUBJECTS).flatMap((s) => s.terms.slice(0, 25));

  const CLASSIFY_PROMPT = `Urči, o jaký předmět jde v této ukázce přepisu výukové hodiny. Možnosti: ${Object.keys(SUBJECTS).join(", ")}.
Somatologie = anatomie a fyziologie člověka (kosti, svaly, orgány, soustavy). Biologie = obecná biologie, buňka, genetika, ekologie, evoluce, mikroorganismy.
Odpověz pouze jedním slovem z možností, malými písmeny, bez diakritiky navíc.`;

  window.Subjects = { SUBJECTS, BASE_NOTES_PROMPT, AUTO_CONTEXT, AUTO_TERMS, CLASSIFY_PROMPT };
})();
