export type Language = "en" | "hi";

const dictionary = {
  en: {
    signedIn: "Signed in",
    portal: "Portal",
    signOut: "Sign out",
    dashboard: "Dashboard",
    blocks: "Blocks",
    slabs: "Slabs",
    planning: "Planning",
    cutting: "Cutting",
    carvingAssign: "Carving Assign",
    carving: "Carving",
    users: "Users",
    vendorWorkspace: "Vendor workspace",
    sharedWorkflow: "Shared web workflow",
    owner: "Owner",
    planner: "Planner",
    block_entry: "Block Entry",
    slab_entry: "Slab Entry",
    worker: "Worker",
    carving_assigner: "Carving Assigner",
    dispatch: "Dispatch",
    vendor: "Vendor",
    language: "Language",
    english: "English",
    hindi: "Hindi"
  },
  hi: {
    signedIn: "साइन इन",
    portal: "पोर्टल",
    signOut: "साइन आउट",
    dashboard: "डैशबोर्ड",
    blocks: "ब्लॉक्स",
    slabs: "स्लैब्स",
    planning: "प्लानिंग",
    cutting: "कटिंग",
    carvingAssign: "कार्विंग असाइन",
    carving: "कार्विंग",
    users: "यूज़र्स",
    vendorWorkspace: "वेंडर वर्कस्पेस",
    sharedWorkflow: "शेयर्ड वेब वर्कफ़्लो",
    owner: "ओनर",
    planner: "प्लानर",
    block_entry: "ब्लॉक एंट्री",
    slab_entry: "स्लैब एंट्री",
    worker: "वर्कर",
    carving_assigner: "कार्विंग असाइनर",
    dispatch: "डिस्पैच",
    vendor: "वेंडर",
    language: "भाषा",
    english: "अंग्रेज़ी",
    hindi: "हिंदी"
  }
} as const;

export function getLanguage(value: string | undefined): Language {
  return value === "hi" ? "hi" : "en";
}

export function t(lang: Language, key: keyof typeof dictionary.en) {
  return dictionary[lang][key];
}
