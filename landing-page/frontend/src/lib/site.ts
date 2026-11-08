/**
 * Public website settings: contact details and plan prices shown on the
 * landing page. Change them here; nothing else needs editing.
 */
export const SITE = {
  company: 'Lumi AI Solutions',
  product: 'SmartHR by Lumi AI',
  /** WhatsApp number in international form, digits only (94 = Sri Lanka). */
  whatsapp: '94770000000',
  /** The same number as people read it. */
  phoneDisplay: '+94 77 000 0000',
  email: 'support@lumiai.lk',
  address: 'Colombo, Sri Lanka',
  whatsappText: 'Hi Lumi AI, I would like a demo of SmartHR for my company.',
};

export const whatsappLink = (text = SITE.whatsappText) => `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(text)}`;
