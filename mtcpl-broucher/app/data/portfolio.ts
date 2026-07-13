export interface PortfolioItem {
  name: string;
  loc: string;
  img: string;
}

// A rotating pool of images for the thumbs (we repeat them — readers
// will scan names/locations as the primary data).
const IMG_POOL = [
  "/images/temple-arch.jpg",
  "/images/about-temple.jpg",
  "/images/temple-sunset.jpg",
  "/images/carving-detail.png",
  "/images/craft-detail.jpg",
  "/images/welcome-temple.avif",
  "/images/project-pipleshwar.jpg",
  "/images/project-trivikrama.jpg",
  "/images/about-construction.jpg",
  "/images/trust-construction.jpg",
  "/images/installation-site.jpg",
];

function img(i: number) {
  return IMG_POOL[i % IMG_POOL.length];
}

export const PORTFOLIO: PortfolioItem[] = [
  // Page 16 (first 20)
  { name: "Jain Mandir", loc: "Delwara · Rajasthan", img: img(0) },
  { name: "Jain Mandir", loc: "Bangalore · Karnataka", img: img(1) },
  { name: "Jain Mandir", loc: "Ankleshwar · Gujarat", img: img(2) },
  { name: "Jain Mandir", loc: "Ahmednagar · Maharashtra", img: img(3) },
  { name: "Hari Mandir", loc: "Baneshwar · Rajasthan", img: img(4) },
  { name: "Shri Shiv Temple", loc: "Kasindra · Gujarat", img: img(5) },
  { name: "Mahadev Mandir Niliya", loc: "Chittorgarh · MP border", img: img(6) },
  { name: "Deesa Jain Temple", loc: "Banaskantha · Gujarat", img: img(7) },
  { name: "Shri Jain Mandir", loc: "Ummedpur · Rajasthan", img: img(8) },
  { name: "Shri Mataji Mandir", loc: "Lilsar · Rajasthan", img: img(9) },
  { name: "Shri Jain Mandir", loc: "Ooty · Tamil Nadu", img: img(10) },
  { name: "Shri Jain Mandir", loc: "Neemuch · MP", img: img(11) },
  { name: "Shri Jain Mandir", loc: "Khiwada · Rajasthan", img: img(12) },
  { name: "Jain Mandir", loc: "Posaliya · Rajasthan", img: img(13) },
  { name: "Puna Temple", loc: "Puna · Maharashtra", img: img(14) },
  { name: "Jain Temple Takhatgarh", loc: "Rajasthan", img: img(15) },
  { name: "Thakurji Mandir", loc: "Revtala · Rajasthan", img: img(16) },
  { name: "Tankiji Maharaj Mandir", loc: "Soda · Rajasthan", img: img(17) },
  { name: "Dhararatna Jain Temple", loc: "Neemuch · MP", img: img(18) },
  { name: "Shimandar Dham", loc: "Ummedpur · Rajasthan", img: img(19) },

  // Page 17 (next 20)
  { name: "Mukti Vihar Dham", loc: "Ahore · Rajasthan", img: img(20) },
  { name: "Mataji Temple Paldi", loc: "Gujarat", img: img(21) },
  { name: "Mataji Mandir Ghanchi", loc: "Pindwara · Rajasthan", img: img(22) },
  { name: "Mataji Mandir Amirgarh", loc: "Banaskantha · Gujarat", img: img(23) },
  { name: "Jin Hushal Vatika", loc: "Barmer · Rajasthan", img: img(24) },
  { name: "Jammu Deep Hastinapur", loc: "Uttar Pradesh", img: img(25) },
  { name: "Jain Temple Uchachan", loc: "Rajasthan", img: img(26) },
  { name: "Jain Temple Raipur", loc: "Chhattisgarh", img: img(27) },
  { name: "Jain Temple Radhanpur", loc: "Gujarat", img: img(28) },
  { name: "Jain Temple Pune", loc: "Maharashtra", img: img(29) },
  { name: "Jain Temple Pali", loc: "Rajasthan", img: img(30) },
  { name: "Jain Temple Nadol", loc: "Pali · Rajasthan", img: img(31) },
  { name: "Jain Temple Kaktour", loc: "Nellore · Andhra", img: img(32) },
  { name: "Jain Temple Vambhori", loc: "Maharashtra", img: img(33) },
  { name: "Jain Temple Swakar Peth", loc: "Chennai · Tamil Nadu", img: img(34) },
  { name: "Jain Temple Jalore", loc: "Rajasthan", img: img(35) },
  { name: "Jain Temple Hadapsar", loc: "Pune · Maharashtra", img: img(36) },
  { name: "Jain Temple Falna", loc: "Rajasthan", img: img(37) },
  { name: "Jain Temple Bhartinagar", loc: "Chennai · Tamil Nadu", img: img(38) },
  { name: "Jain Temple Ankleshwar", loc: "Gujarat", img: img(39) },
];
