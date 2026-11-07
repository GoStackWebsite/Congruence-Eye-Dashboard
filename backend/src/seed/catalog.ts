/** Reference data for Congruence stores (Chennai + Coimbatore). */
export interface StoreDef {
  code: string;
  name: string;
  region: 'Chennai' | 'Coimbatore';
  city: string;
  address: string;
  lat: number;
  lng: number;
  areaSqft: number;
  openTime: string;
  closeTime: string;
  baseConversion: number; // 0.18 – 0.35
  atv: number; // INR
  managerEmail: string;
  managerName: string;
  short: string;
  format: 'HIGH_STREET' | 'MALL' | 'AIRPORT' | 'OUTLET' | 'KIOSK';
}

export const STORES: StoreDef[] = [
  { code: 'CNG-TNR', format: 'HIGH_STREET', short: 'TNR', name: 'Congruence T Nagar', region: 'Chennai', city: 'Chennai', address: '54, Usman Road, T Nagar, Chennai, Tamil Nadu 600017', lat: 13.0418, lng: 80.2341, areaSqft: 9000, openTime: '10:00', closeTime: '21:30', baseConversion: 0.29, atv: 2250, managerEmail: 'manager.tnagar@congruence.in', managerName: 'Karthik Subramanian' },
  { code: 'CNG-ANN', format: 'HIGH_STREET', short: 'ANN', name: 'Congruence Anna Nagar', region: 'Chennai', city: 'Chennai', address: 'AC-12, 2nd Avenue, Anna Nagar, Chennai, Tamil Nadu 600040', lat: 13.085, lng: 80.2101, areaSqft: 6500, openTime: '10:00', closeTime: '21:30', baseConversion: 0.26, atv: 2450, managerEmail: 'manager.annanagar@congruence.in', managerName: 'Meena Rajendran' },
  { code: 'CNG-VEL', format: 'MALL', short: 'VEL', name: 'Congruence Phoenix Marketcity Velachery', region: 'Chennai', city: 'Chennai', address: 'Unit F-12, Phoenix Marketcity, 142 Velachery Main Road, Velachery, Chennai, Tamil Nadu 600042', lat: 12.9915, lng: 80.217, areaSqft: 7500, openTime: '10:00', closeTime: '22:00', baseConversion: 0.22, atv: 3200, managerEmail: 'manager.velachery@congruence.in', managerName: 'Sanjay Venkatesan' },
  { code: 'CNG-ADY', format: 'OUTLET', short: 'ADY', name: 'Congruence Adyar', region: 'Chennai', city: 'Chennai', address: '21, Lattice Bridge Road, Adyar, Chennai, Tamil Nadu 600020', lat: 13.0012, lng: 80.2565, areaSqft: 4200, openTime: '10:00', closeTime: '21:30', baseConversion: 0.31, atv: 2650, managerEmail: 'manager.adyar@congruence.in', managerName: 'Revathi Krishnan' },
  { code: 'CNG-OMR', format: 'MALL', short: 'OMR', name: 'Congruence OMR Sholinganallur', region: 'Chennai', city: 'Chennai', address: 'Plot 7, Rajiv Gandhi Salai (OMR), Sholinganallur, Chennai, Tamil Nadu 600119', lat: 12.901, lng: 80.2279, areaSqft: 5200, openTime: '10:30', closeTime: '21:30', baseConversion: 0.24, atv: 1850, managerEmail: 'manager.omr@congruence.in', managerName: 'Vignesh Anand' },
  { code: 'CNG-CBE', format: 'HIGH_STREET', short: 'CBE', name: 'Congruence RS Puram', region: 'Coimbatore', city: 'Coimbatore', address: '145, DB Road, RS Puram, Coimbatore, Tamil Nadu 641002', lat: 11.0089, lng: 76.95, areaSqft: 3500, openTime: '10:00', closeTime: '21:00', baseConversion: 0.33, atv: 1550, managerEmail: 'manager.rspuram@congruence.in', managerName: 'Gowtham Palanisamy' },
];

export interface SectionDef {
  name: string;
  cam: 0 | 1 | 2; // index of floor camera
  weight: number; // popularity
  dwell: number; // average zone dwell seconds
  engagedRate: number;
  femaleShare: number;
  center: [number, number];
}

export const SECTIONS: SectionDef[] = [
  { name: "Men's Wear", cam: 0, weight: 1.0, dwell: 150, engagedRate: 0.55, femaleShare: 0.25, center: [0.28, 0.45] },
  { name: "Women's Wear", cam: 0, weight: 1.35, dwell: 190, engagedRate: 0.62, femaleShare: 0.82, center: [0.72, 0.5] },
  { name: 'Kids', cam: 1, weight: 0.6, dwell: 125, engagedRate: 0.5, femaleShare: 0.62, center: [0.3, 0.4] },
  { name: 'Footwear', cam: 1, weight: 0.75, dwell: 160, engagedRate: 0.52, femaleShare: 0.5, center: [0.7, 0.6] },
  { name: 'Accessories', cam: 2, weight: 0.45, dwell: 85, engagedRate: 0.38, femaleShare: 0.7, center: [0.22, 0.35] },
  { name: 'Trial Rooms', cam: 2, weight: 0.3, dwell: 240, engagedRate: 0.8, femaleShare: 0.58, center: [0.55, 0.3] },
  { name: 'New Arrivals', cam: 2, weight: 0.85, dwell: 110, engagedRate: 0.45, femaleShare: 0.55, center: [0.8, 0.7] },
];

export const FLOOR_CAMS = ['Floor - Ground (Apparel)', 'Floor - First (Kids & Footwear)', 'Floor - Second (Accessories)'];

export const AGE_DIST: [string, number][] = [
  ['0-17', 0.09], ['18-24', 0.22], ['25-34', 0.31], ['35-44', 0.18], ['45-54', 0.12], ['55+', 0.06], ['U', 0.02],
];

export const STAFF_NAMES = [
  'Arjun Ravi', 'Kavya Senthil', 'Manoj Kumar', 'Nithya Prakash', 'Suresh Babu', 'Anitha Joseph', 'Rahul Krishnan', 'Pooja Iyer',
  'Dinesh Selvam', 'Harini Shankar', 'Vijay Mohan', 'Keerthana Balaji', 'Prakash Raj', 'Sneha Gopal', 'Bala Murugan', 'Swathi Narayan',
  'Ganesh Pandian', 'Janani Vel', 'Ashwin Sekar', 'Deepa Sundaram', 'Mohan Das', 'Lavanya Kannan', 'Sathish Kumar', 'Ramya Devi',
];
export const DESIGNATIONS = ['Store Supervisor', 'Cashier', 'Cashier', 'Sales Associate', 'Sales Associate', 'Sales Associate', 'Visual Merchandiser', 'Security'];

/** Diwali dates for festive seasonality. */
export const DIWALI = ['2024-11-01', '2025-10-20', '2026-11-08', '2027-10-29', '2028-10-17'];
