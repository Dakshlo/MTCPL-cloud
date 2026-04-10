export type Language = "en" | "hi";

const dictionary = {
  en: {
    signedIn: "Signed in",
    signOut: "Sign out",
    dashboard: "Dashboard",
    blocks: "Blocks",
    slabs: "Slabs",
    planning: "Plan Generator",
    cutting: "Cutting",
    owner: "Owner",
    planner: "Planner",
    block_entry: "Block Entry",
    slab_entry: "Slab Entry",
    worker: "Worker",
    cft: "CFT",
    stoneType: "Stone Type",
    yard: "Yard"
  },
  hi: {
    signedIn: "साइन इन",
    signOut: "साइन आउट",
    dashboard: "डैशबोर्ड",
    blocks: "ब्लॉक्स",
    slabs: "स्लैब्स",
    planning: "प्लान जनरेटर",
    cutting: "कटिंग",
    owner: "ओनर",
    planner: "प्लानर",
    block_entry: "ब्लॉक एंट्री",
    slab_entry: "स्लैब एंट्री",
    worker: "वर्कर",
    cft: "सीएफटी",
    stoneType: "स्टोन टाइप",
    yard: "यार्ड"
  }
} as const;

export function getLanguage(value: string | undefined): Language {
  return value === "hi" ? "hi" : "en";
}

export function t(lang: Language, key: keyof typeof dictionary.en) {
  return dictionary[lang][key];
}
