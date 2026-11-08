/** Feature and plan text in English and Sinhala. Only these sections switch language. */

export type Lang = 'en' | 'si';
export type T = Record<Lang, string>;

export type IconName =
  | 'pin' | 'calendar' | 'leaf' | 'clock' | 'wallet' | 'shield'
  | 'phone' | 'coins' | 'megaphone' | 'laptop' | 'branches' | 'chart';

export const featuresHead: { kicker: T; title: T; text: T } = {
  kicker: { en: 'Features', si: 'විශේෂාංග' },
  title: { en: 'Everything your HR team needs, in one place', si: 'ඔබේ HR කණ්ඩායමට අවශ්‍ය සියල්ල, එකම තැනක' },
  text: {
    en: 'Built for Sri Lankan labour law and payroll — EPF, ETF, APIT, holidays and Colombo time are already set up.',
    si: 'ශ්‍රී ලංකා කම්කරු නීතියට සහ වැටුප් ක්‍රමයට ගැලපෙන ලෙස සාදා ඇත — EPF, ETF, APIT, නිවාඩු දින සහ ශ්‍රී ලංකා වේලාව දැනටමත් සකසා ඇත.',
  },
};

export const features: { icon: IconName; title: T; text: T }[] = [
  {
    icon: 'pin',
    title: { en: 'Attendance with GPS', si: 'GPS සමඟ පැමිණීම' },
    text: {
      en: 'Staff mark in and out from the app — at the office or remote. Works without internet and updates when back online.',
      si: 'සේවකයින් ඇප් එකෙන් පැමිණීම සහ පිටවීම සලකුණු කරයි — කාර්යාලයේ සිට හෝ දුරස්ථව. අන්තර්ජාලය නැතිවත් ක්‍රියා කර, සම්බන්ධ වූ විට යාවත්කාලීන වේ.',
    },
  },
  {
    icon: 'calendar',
    title: { en: 'Rosters and shifts', si: 'රොස්ටර් සහ ෂිෆ්ට්' },
    text: {
      en: 'Plan weekly rosters, night shifts and split shifts. Everyone sees their roster on their phone.',
      si: 'සතිපතා රොස්ටර්, රාත්‍රී ෂිෆ්ට් සහ බෙදුණු ෂිෆ්ට් සැලසුම් කරන්න. සෑම කෙනෙකුටම තම රොස්ටරය දුරකථනයෙන්ම බලාගත හැක.',
    },
  },
  {
    icon: 'leaf',
    title: { en: 'Leave management', si: 'නිවාඩු කළමනාකරණය' },
    text: {
      en: 'Annual, casual and medical leave with live balances, half days and one-tap approval.',
      si: 'වාර්ෂික, අනියම් සහ වෛද්‍ය නිවාඩු — ඉතිරි නිවාඩු ශේෂය, අර්ධ දින සහ එක් ස්පර්ශයකින් අනුමැතිය.',
    },
  },
  {
    icon: 'clock',
    title: { en: 'Overtime control', si: 'අතිකාල පාලනය' },
    text: {
      en: 'Planned and unplanned overtime, reasons from staff, the weekly limit and manager approval.',
      si: 'සැලසුම් කළ සහ නොකළ අතිකාල, සේවකයාගෙන් හේතුව, සතිපතා සීමාව සහ කළමනාකරු අනුමැතිය.',
    },
  },
  {
    icon: 'wallet',
    title: { en: 'Payroll in minutes', si: 'මිනිත්තු කිහිපයකින් වැටුප්' },
    text: {
      en: 'Salary, allowances, no-pay, overtime and holiday pay calculated for you. Payslips as PDF.',
      si: 'වැටුප, දීමනා, වැටුප් රහිත දින, අතිකාල සහ නිවාඩු දින ගෙවීම් ස්වයංක්‍රීයව ගණනය වේ. වැටුප් පත්‍රිකා PDF ලෙස.',
    },
  },
  {
    icon: 'shield',
    title: { en: 'EPF, ETF and APIT', si: 'EPF, ETF සහ APIT' },
    text: {
      en: 'EPF 8% + 12%, ETF 3% and APIT worked out each month, with return files and the bank transfer file.',
      si: 'EPF 8% + 12%, ETF 3% සහ APIT සෑම මසකම ගණනය කර, ප්‍රකාශන ගොනු සහ බැංකු මාරු ගොනුව සූදානම් කරයි.',
    },
  },
  {
    icon: 'phone',
    title: { en: 'Employee mobile app', si: 'සේවක ජංගම ඇප් එක' },
    text: {
      en: 'For iPhone and Android: attendance, roster, leave, payslips and company notices.',
      si: 'iPhone සහ Android සඳහා: පැමිණීම, රොස්ටරය, නිවාඩු, වැටුප් පත්‍රිකා සහ ආයතනික නිවේදන.',
    },
  },
  {
    icon: 'coins',
    title: { en: 'Loans and advances', si: 'ණය සහ අත්තිකාරම්' },
    text: {
      en: 'Salary advances and staff loans, deducted from pay automatically every month.',
      si: 'වැටුප් අත්තිකාරම් සහ සේවක ණය, සෑම මසකම වැටුපෙන් ස්වයංක්‍රීයව අඩු කෙරේ.',
    },
  },
  {
    icon: 'megaphone',
    title: { en: 'Notices and messages', si: 'නිවේදන සහ පණිවිඩ' },
    text: {
      en: 'Send a notice to everyone or one branch, see who read it, and chat with staff.',
      si: 'සියලු දෙනාට හෝ එක් ශාඛාවකට නිවේදනයක් යවන්න, කියවූයේ කවුදැයි බලන්න, සේවකයින් සමඟ කතාබහ කරන්න.',
    },
  },
  {
    icon: 'laptop',
    title: { en: 'Company assets', si: 'ආයතනික උපකරණ' },
    text: {
      en: 'Keep track of laptops, phones, SIMs and uniforms given to each employee.',
      si: 'එක් එක් සේවකයාට දුන් ලැප්ටොප්, දුරකථන, SIM කාඩ් සහ නිල ඇඳුම් සටහන් කර තබාගන්න.',
    },
  },
  {
    icon: 'branches',
    title: { en: 'Branches and roles', si: 'ශාඛා සහ භූමිකා' },
    text: {
      en: 'Branch HR officers, managers and payroll staff each see only what they should.',
      si: 'ශාඛා HR නිලධාරීන්ට, කළමනාකරුවන්ට සහ වැටුප් කාර්ය මණ්ඩලයට තමන්ට අදාළ දේ පමණක් පෙනේ.',
    },
  },
  {
    icon: 'chart',
    title: { en: 'Reports and gratuity', si: 'වාර්තා සහ පාරිතෝෂිකය' },
    text: {
      en: 'Attendance, leave and payroll reports, Excel export and your gratuity liability at a glance.',
      si: 'පැමිණීම, නිවාඩු සහ වැටුප් වාර්තා, Excel ලෙස බාගැනීම සහ පාරිතෝෂික වගකීම එක බැල්මෙන්.',
    },
  },
];

export const plansHead: { kicker: T; title: T; text: T; month: T; year: T; demo: T; popular: T; employees: T } = {
  kicker: { en: 'Plans', si: 'පැකේජ' },
  title: { en: 'Simple monthly plans', si: 'සරල මාසික පැකේජ' },
  text: {
    en: 'Every plan includes attendance, leave, payroll, EPF/ETF returns and the mobile app.',
    si: 'සෑම පැකේජයකටම පැමිණීම, නිවාඩු, වැටුප්, EPF/ETF ප්‍රකාශන සහ ජංගම ඇප් එක ඇතුළත් වේ.',
  },
  month: { en: '/ month', si: '/ මසකට' },
  year: { en: 'or {y} a year — two months free', si: 'නැතහොත් වසරකට {y} — මාස දෙකක් නොමිලේ' },
  demo: { en: 'Ask for a free demo', si: 'නොමිලේ demo එකක් ඉල්ලන්න' },
  popular: { en: 'Most popular', si: 'වැඩිපුරම තෝරන' },
  employees: { en: 'Up to {n} employees', si: 'සේවකයින් {n} දක්වා' },
};

export const plans: { name: string; price: string; year: string; max: number; popular?: boolean; items: T[] }[] = [
  {
    name: 'Starter',
    price: '2,500',
    year: 'Rs 25,000',
    max: 25,
    items: [
      { en: 'Attendance, leave and payroll', si: 'පැමිණීම, නිවාඩු සහ වැටුප්' },
      { en: 'EPF, ETF and APIT returns', si: 'EPF, ETF සහ APIT ප්‍රකාශන' },
      { en: 'Overtime and notices', si: 'අතිකාල සහ නිවේදන' },
      { en: 'Employee documents', si: 'සේවක ලේඛන' },
      { en: 'Import staff from Excel', si: 'Excel මගින් සේවක දත්ත ඇතුළත් කිරීම' },
    ],
  },
  {
    name: 'Growth',
    price: '6,500',
    year: 'Rs 65,000',
    max: 100,
    popular: true,
    items: [
      { en: 'Everything in Starter', si: 'Starter හි සියල්ල' },
      { en: 'Rosters and shift patterns', si: 'රොස්ටර් සහ ෂිෆ්ට් රටා' },
      { en: 'Loans and salary advances', si: 'ණය සහ වැටුප් අත්තිකාරම්' },
      { en: 'Assets and staff messaging', si: 'උපකරණ සහ සේවක පණිවිඩ' },
      { en: 'Reports and Excel exports', si: 'වාර්තා සහ Excel බාගැනීම්' },
    ],
  },
  {
    name: 'Complete',
    price: '14,000',
    year: 'Rs 140,000',
    max: 500,
    items: [
      { en: 'Everything in Growth', si: 'Growth හි සියල්ල' },
      { en: 'Fingerprint and face terminals', si: 'ඇඟිලි සලකුණු සහ මුහුණු හඳුනාගැනීමේ යන්ත්‍ර' },
      { en: 'Face check in the app', si: 'ඇප් එකේ මුහුණු පරීක්ෂාව' },
      { en: 'Branch HR officers', si: 'ශාඛා HR නිලධාරීන්' },
      { en: 'Multi-branch overview', si: 'සියලු ශාඛා එකවර බැලීම' },
    ],
  },
];

export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
