/**
 * Public website settings: contact details and plan prices shown on the
 * landing page. Change them here; nothing else needs editing.
 */
export const SITE = {
  company: 'Lumi Automation',
  product: 'SmartHR by Lumi AI',
  /** WhatsApp number in international form, digits only (94 = Sri Lanka). */
  whatsapp: '94770318433',
  /** The same number as people read it. */
  phoneDisplay: '077 031 8433',
  email: 'info.lumiautomation@gmail.com',
  address: 'Colombo, Sri Lanka',
  whatsappText: 'Hi Lumi Automation, I would like a demo of SmartHR for my company.',
};

export const whatsappLink = (text = SITE.whatsappText) => `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(text)}`;
